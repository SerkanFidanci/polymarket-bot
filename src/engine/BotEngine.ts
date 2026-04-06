import { binanceWS } from '../websocket/BinanceWS.js';
import { streamManager } from '../websocket/StreamManager.js';
import { signalEngine } from './SignalEngine.js';
import { bankrollManager } from './BankrollManager.js';
import { trainingManager } from './TrainingManager.js';
import { tradingLoop } from '../trading/TradingLoop.js';
import { logger } from '../utils/logger.js';
import type { CombinedSignal, LogEntry, Decision, SystemStatus } from '../types/index.js';
import type { SignalAccuracy, SignalWeights } from '../types/signals.js';
import type { PhaseStatus } from './PhaseController.js';

type StateUpdater = {
  setBtcPrice: (p: number) => void;
  setCurrentSignal: (s: CombinedSignal) => void;
  setSystemStatus: (s: string) => void;
  setConnected: (c: boolean) => void;
  setFuturesConnected: (c: boolean) => void;
  addLog: (l: LogEntry) => void;
  setWarmupStartTime: (t: number | null) => void;
  setTrainingRoundsCount: (n: number) => void;
  setLastDecision: (d: Decision) => void;
  setBankroll: (b: Record<string, unknown>) => void;
  setTradingMode: (m: string) => void;
  setSignalAccuracies: (a: SignalAccuracy[]) => void;
  setProposedWeights: (w: SignalWeights | null) => void;
  setPhaseStatus: (s: PhaseStatus | null) => void;
  setSignalWeights: (w: SignalWeights) => void;
  addOptimizationEntry: (e: Record<string, unknown>) => void;
};

let isRunning = false;
let isStarting = false;
let warmupTimer: ReturnType<typeof setTimeout> | null = null;
let serverPollInterval: ReturnType<typeof setInterval> | null = null;
const WARMUP_DURATION = 15000;

// Handle HMR: clean up everything on module reload
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    isRunning = false;
    isStarting = false;
    if (warmupTimer) clearTimeout(warmupTimer);
    if (serverPollInterval) clearInterval(serverPollInterval);
    warmupTimer = null;
    serverPollInterval = null;
  });
}

export async function startBot(store: StateUpdater): Promise<void> {
  if (isRunning || isStarting) return;
  isStarting = true;

  logger.info('Bot', 'Starting BTC Polymarket Trading Bot...');
  store.setSystemStatus('INITIALIZING');

  // Log listener -> store
  logger.onLog((entry) => store.addLog(entry));

  // Connect Binance WebSocket (frontend keeps its own WS for real-time chart display)
  try {
    await streamManager.start();

    binanceWS.on('connected', (label) => {
      if (label === 'spot') store.setConnected(true);
      if (label === 'futures') store.setFuturesConnected(true);
    });

    binanceWS.on('disconnected', (label) => {
      if (label === 'spot') store.setConnected(false);
      if (label === 'futures') store.setFuturesConnected(false);
    });

    // Price updates from trades
    binanceWS.on('trade', (trade: unknown) => {
      const t = trade as { price: number };
      store.setBtcPrice(t.price);
    });
    binanceWS.on('aggTrade', (trade: unknown) => {
      const t = trade as { price: number };
      store.setBtcPrice(t.price);
    });

    // Fallback: poll lastTradePrice every 200ms
    setInterval(() => {
      if (binanceWS.lastTradePrice > 0) {
        store.setBtcPrice(binanceWS.lastTradePrice);
      }
    }, 200);

    isRunning = true;
    isStarting = false;
    store.setConnected(binanceWS.isConnected);
    store.setFuturesConnected(true);

    logger.info('Bot', 'Binance streams connected');
  } catch (err) {
    isStarting = false;
    logger.error('Bot', `Failed to connect: ${err}`);
    store.setSystemStatus('ERROR');
    return;
  }

  // Warmup phase
  store.setSystemStatus('WARMING_UP');
  store.setWarmupStartTime(Date.now());
  logger.info('Bot', `Warming up for ${WARMUP_DURATION / 1000}s...`);

  warmupTimer = setTimeout(() => {
    store.setSystemStatus('RUNNING');
    store.setWarmupStartTime(null);
    logger.info('Bot', 'Warmup complete — system RUNNING');

    // Initialize bankroll
    const initialBalance = 50;
    bankrollManager.init(initialBalance);
    bankrollManager.onChange((b) => store.setBankroll(b as unknown as Record<string, unknown>));

    // Detect trading mode
    const tradingMode: 'passive' | 'paper' | 'live' = 'passive';
    tradingLoop.setMode(tradingMode);
    store.setTradingMode(tradingMode);

    // Start signal engine (every 1 second) for frontend display
    signalEngine.start(1000);

    // Forward signal updates to store
    signalEngine.onSignal((signal) => {
      store.setCurrentSignal(signal);
    });

    // Set up training manager
    trainingManager.setCallbacks({
      onAccuracyUpdate: (accs) => store.setSignalAccuracies(accs),
      onWeightsProposed: (_current, proposed) => {
        store.setProposedWeights(proposed);
        store.setSignalWeights(proposed);
      },
      onPhaseStatusUpdate: (status) => store.setPhaseStatus(status),
      onOptimizationComplete: (applied, reason) => {
        store.addOptimizationEntry({
          timestamp: new Date().toISOString(),
          type: 'weights',
          roundsAnalyzed: 0,
          improvement: 0,
          applied,
          reason,
        });
      },
    });

    // Start trading loop
    tradingLoop.start({
      onDecision: (d) => store.setLastDecision(d),
      onStatusChange: (s) => store.setSystemStatus(s as SystemStatus),
      onBankrollUpdate: () => store.setBankroll(bankrollManager.getState() as unknown as Record<string, unknown>),
    });

    // Poll server for training round count (training loop now runs server-side)
    startServerDataPoll(store);
  }, WARMUP_DURATION);
}

function startServerDataPoll(store: StateUpdater) {
  const poll = async () => {
    try {
      // Always read count directly from DB endpoint — single source of truth
      const res = await fetch('/api/training-rounds/count');
      if (res.ok) {
        const data = await res.json() as { count: number };
        store.setTrainingRoundsCount(data.count);
      }
    } catch { /* silent */ }
  };

  // Poll every 5 seconds for round count updates from server
  poll();
  if (serverPollInterval) clearInterval(serverPollInterval);
  serverPollInterval = setInterval(poll, 5000);

  // Browsers throttle setInterval to ~1/min in background tabs.
  // When tab becomes visible again, poll immediately.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      poll();
    }
  });
}

export function stopBot(): void {
  if (!isRunning) return;
  isRunning = false;
  if (warmupTimer) clearTimeout(warmupTimer);
  if (serverPollInterval) clearInterval(serverPollInterval);
  signalEngine.stop();
  streamManager.stop();
  logger.info('Bot', 'Bot stopped');
}

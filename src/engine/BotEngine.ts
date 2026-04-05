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
let trainingInterval: ReturnType<typeof setInterval> | null = null;
let roundCounter = 0;
const WARMUP_DURATION = 15000;

// Handle HMR: clean up everything on module reload
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    isRunning = false;
    isStarting = false;
    if (warmupTimer) clearTimeout(warmupTimer);
    if (trainingInterval) clearInterval(trainingInterval);
    warmupTimer = null;
    trainingInterval = null;
  });
}

export async function startBot(store: StateUpdater): Promise<void> {
  if (isRunning || isStarting) return;
  isStarting = true;

  logger.info('Bot', 'Starting BTC Polymarket Trading Bot...');
  store.setSystemStatus('INITIALIZING');

  // Log listener -> store
  logger.onLog((entry) => store.addLog(entry));

  // Connect Binance WebSocket
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

    // Fallback: poll lastTradePrice every 200ms (handles HMR/StrictMode edge cases)
    setInterval(() => {
      if (binanceWS.lastTradePrice > 0) {
        store.setBtcPrice(binanceWS.lastTradePrice);
      }
    }, 200);

    isRunning = true;
    isStarting = false;
    store.setConnected(binanceWS.isConnected);
    store.setFuturesConnected(true); // REST polling is active

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

    // Initialize bankroll (fetch from server state)
    const initialBalance = 50;
    bankrollManager.init(initialBalance);
    bankrollManager.onChange((b) => store.setBankroll(b as unknown as Record<string, unknown>));

    // Detect trading mode from server
    const tradingMode: 'passive' | 'paper' | 'live' = 'passive';
    tradingLoop.setMode(tradingMode);
    store.setTradingMode(tradingMode);

    // Start signal engine (every 1 second)
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

    // Training round recording (simulated 5-min rounds for passive mode)
    startTrainingLoop(store);
  }, WARMUP_DURATION);
}

async function startTrainingLoop(store: StateUpdater) {
  // Fetch existing count
  try {
    const res = await fetch('/api/training-rounds/count');
    if (res.ok) {
      const data = await res.json() as { count: number };
      roundCounter = data.count;
      store.setTrainingRoundsCount(roundCounter);
      logger.info('Training', `Loaded ${roundCounter} existing training rounds`);
    }
  } catch { /* ignore */ }

  // Track Polymarket rounds — record data at round START, save result at round END
  let currentSlug = '';
  let roundStartPrice = 0;
  let roundUpPrice = 0;
  let roundDownPrice = 0;
  let roundStartTime = '';
  let startSignalSnapshot: typeof signalEngine extends { getLastSignal(): infer R } ? R : never = null;

  const pollRound = async () => {
    try {
      // Fetch current Polymarket round
      const res = await fetch('/api/polymarket/current-round');
      if (!res.ok) return;
      const round = await res.json() as {
        slug?: string;
        title?: string;
        tokenIdUp?: string;
        tokenIdDown?: string;
        priceUp?: number;
        priceDown?: number;
        endTime?: number;
        found?: boolean;
      };

      if (round.found === false || !round.slug) return;

      // NEW ROUND detected — save previous round's result and start tracking new one
      if (round.slug !== currentSlug) {
        // Save previous round (if we had one)
        if (currentSlug && roundStartPrice > 0 && startSignalSnapshot) {
          const endPrice = binanceWS.lastTradePrice;

          // Determine result from Polymarket prices (Chainlink oracle)
          // Round-end PM prices: winner → ~1.00, loser → ~0.00
          let result: string;
          if (roundUpPrice > 0.7) {
            result = 'UP';
          } else if (roundDownPrice > 0.7) {
            result = 'DOWN';
          } else {
            // PM prices not yet resolved — fallback to BTC price
            result = endPrice >= roundStartPrice ? 'UP' : 'DOWN';
          }

          // Calculate hypothetical decision
          const score = startSignalSnapshot.finalScore;
          const conf = startSignalSnapshot.confidence;
          let hypDecision = 'SKIP';
          let hypBetSize = 0;
          let hypPnl = 0;
          if (Math.abs(score) > 15 && conf > 30) {
            hypDecision = score > 0 ? 'BUY_UP' : 'BUY_DOWN';
            const dir = score > 0 ? 'UP' : 'DOWN';
            const price = dir === 'UP' ? roundUpPrice : roundDownPrice;
            hypBetSize = Math.min(50 * 0.05, 5); // conservative estimate
            const won = dir === result;
            hypPnl = won ? hypBetSize * ((1 - price) / price) : -hypBetSize;
          }

          const roundData = {
            roundStartTime,
            roundEndTime: new Date().toISOString(),
            btcPriceStart: roundStartPrice,
            btcPriceEnd: endPrice,
            actualResult: result,
            polymarketUpPrice: roundUpPrice,
            polymarketDownPrice: roundDownPrice,
            signalOrderbook: startSignalSnapshot.signals.orderbook?.score ?? 0,
            signalEmaMacd: startSignalSnapshot.signals.ema_macd?.score ?? 0,
            signalRsiStoch: startSignalSnapshot.signals.rsi_stoch?.score ?? 0,
            signalVwapBb: startSignalSnapshot.signals.vwap_bb?.score ?? 0,
            signalCvd: startSignalSnapshot.signals.cvd?.score ?? 0,
            signalWhale: startSignalSnapshot.signals.whale?.score ?? 0,
            signalFunding: startSignalSnapshot.signals.funding?.score ?? 0,
            signalOpenInterest: startSignalSnapshot.signals.open_interest?.score ?? 0,
            signalLiquidation: startSignalSnapshot.signals.liquidation?.score ?? 0,
            signalLsRatio: startSignalSnapshot.signals.ls_ratio?.score ?? 0,
            finalScore: startSignalSnapshot.finalScore,
            confidence: startSignalSnapshot.confidence,
            hypotheticalDecision: hypDecision,
            hypotheticalEv: 0,
            hypotheticalBetSize: hypBetSize,
            hypotheticalPnl: hypPnl,
          };

          try {
            const saveRes = await fetch('/api/training-rounds', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(roundData),
            });
            if (saveRes.ok) {
              roundCounter++;
              store.setTrainingRoundsCount(roundCounter);
              logger.trade('Training', `Round #${roundCounter}: ${result} | BTC ${roundStartPrice.toFixed(0)}→${endPrice.toFixed(0)} | PM Up:${(roundUpPrice*100).toFixed(0)}¢ Down:${(roundDownPrice*100).toFixed(0)}¢ | Score:${score.toFixed(1)} → ${hypDecision}`);
              trainingManager.onRoundRecorded(roundCounter, tradingLoop.getMode());
            }
          } catch (err) {
            logger.error('Training', `Save failed: ${err}`);
          }
        }

        // Start tracking new round
        currentSlug = round.slug;
        roundStartPrice = binanceWS.lastTradePrice;
        roundUpPrice = round.priceUp ?? 0.5;
        roundDownPrice = round.priceDown ?? 0.5;
        roundStartTime = new Date().toISOString();
        startSignalSnapshot = signalEngine.getLastSignal();

        logger.info('Training', `Tracking: ${round.title} | Up:${(roundUpPrice*100).toFixed(1)}¢ Down:${(roundDownPrice*100).toFixed(1)}¢`);
      } else {
        // Same round — update prices from CLOB midpoint
        if (round.tokenIdUp && round.tokenIdDown) {
          try {
            const priceRes = await fetch(`/api/polymarket/prices?up=${encodeURIComponent(round.tokenIdUp)}&down=${encodeURIComponent(round.tokenIdDown)}&slug=${round.slug}`);
            if (priceRes.ok) {
              const prices = await priceRes.json() as { priceUp: number; priceDown: number };
              roundUpPrice = prices.priceUp;
              roundDownPrice = prices.priceDown;
            }
          } catch { /* silent */ }
        }
      }
    } catch (err) {
      logger.error('Training', `Poll error: ${err}`);
    }
  };

  // Poll every 10 seconds
  pollRound();
  if (trainingInterval) clearInterval(trainingInterval);
  trainingInterval = setInterval(pollRound, 10000);
}

export function stopBot(): void {
  // Only stop if explicitly requested (not from StrictMode cleanup)
  if (!isRunning) return;
  isRunning = false;
  if (warmupTimer) clearTimeout(warmupTimer);
  signalEngine.stop();
  streamManager.stop();
  logger.info('Bot', 'Bot stopped');
}

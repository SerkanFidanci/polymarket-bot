import { signalEngine } from '../engine/SignalEngine.js';
import { makeDecision } from '../engine/DecisionMaker.js';
import { bankrollManager } from '../engine/BankrollManager.js';
import { riskManager } from './RiskManager.js';
import { roundManager } from './RoundManager.js';
import { evaluateScenarios } from './ScenarioHandler.js';
import { binanceWS } from '../websocket/BinanceWS.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_RISK_CONFIG } from '../types/bankroll.js';
import type { TradingMode, Decision, SystemStatus } from '../types/index.js';

interface TradingLoopCallbacks {
  onDecision: (d: Decision) => void;
  onStatusChange: (s: SystemStatus) => void;
  onBankrollUpdate: () => void;
}

let loopInterval: ReturnType<typeof setInterval> | null = null;
let mode: TradingMode = 'passive';
let hasOpenPosition = false;
let pendingRoundEndTime = 0;
let pendingDirection: 'UP' | 'DOWN' | null = null;
let pendingBetSize = 0;
let pendingEntryPrice = 0;
let roundStartPrice = 0;

export const tradingLoop = {
  setMode(m: TradingMode) {
    mode = m;
    logger.info('TradingLoop', `Mode set to: ${m}`);
  },

  getMode(): TradingMode {
    return mode;
  },

  start(callbacks: TradingLoopCallbacks) {
    logger.info('TradingLoop', 'Starting trading loop (5s interval)');

    loopInterval = setInterval(() => {
      try {
        this.tick(callbacks);
      } catch (err) {
        logger.error('TradingLoop', `Tick error: ${err}`);
      }
    }, 5000);
  },

  stop() {
    if (loopInterval) {
      clearInterval(loopInterval);
      loopInterval = null;
    }
    logger.info('TradingLoop', 'Trading loop stopped');
  },

  tick(callbacks: TradingLoopCallbacks) {
    // Daily reset check
    bankrollManager.checkDailyReset();

    // Update risk assessment
    riskManager.update();

    // Check scenarios
    const scenario = evaluateScenarios();
    if (scenario.suggestedStatus !== 'RUNNING') {
      callbacks.onStatusChange(scenario.suggestedStatus);
    }

    // Check if pending round completed
    if (hasOpenPosition && pendingRoundEndTime > 0 && Date.now() >= pendingRoundEndTime) {
      this.resolveRound(callbacks);
      return;
    }

    // Skip if can't trade
    if (!scenario.canTrade) {
      const decision: Decision = { action: 'SKIP', reason: scenario.reason, timestamp: Date.now() };
      callbacks.onDecision(decision);
      return;
    }

    // Skip if already have open position
    if (hasOpenPosition) {
      const decision: Decision = { action: 'SKIP', reason: 'Waiting for round result', timestamp: Date.now() };
      callbacks.onDecision(decision);
      return;
    }

    // Get current signal
    const signal = signalEngine.getLastSignal();
    if (!signal) {
      const decision: Decision = { action: 'SKIP', reason: 'No signal data', timestamp: Date.now() };
      callbacks.onDecision(decision);
      return;
    }

    // Get round info (simulated in passive/paper mode)
    const round = roundManager.getCurrentRound();
    const timeRemaining = round ? roundManager.getTimeRemaining() : 150; // Default 2.5min
    const priceUp = round?.priceUp ?? 0.50;
    const priceDown = round?.priceDown ?? 0.50;

    // Data freshness
    const dataAge = Date.now() - signal.timestamp;

    // Make decision
    const decision = makeDecision({
      signal,
      bankroll: bankrollManager.getState(),
      config: DEFAULT_RISK_CONFIG,
      priceUp,
      priceDown,
      hasOpenPosition,
      dataAge,
      roundTimeRemaining: timeRemaining,
      highVolatility: riskManager.isHighVolatility(),
      lowLiquidity: riskManager.isLowLiquidity(),
    });

    callbacks.onDecision(decision);

    // Execute if not SKIP
    if (decision.action === 'BUY_UP' || decision.action === 'BUY_DOWN') {
      this.executeBet(decision, callbacks);
    }

    if (decision.action === 'STOP') {
      callbacks.onStatusChange('STOPPED');
      this.stop();
    }
  },

  executeBet(decision: Decision, _callbacks: TradingLoopCallbacks) {
    if (mode === 'passive') {
      // Passive mode: just log, don't execute
      logger.info('TradingLoop', `[PASSIVE] Would ${decision.action} $${decision.betSize?.toFixed(2)} — recording for training`);
      return;
    }

    if (mode === 'paper') {
      // Paper mode: simulate the bet
      hasOpenPosition = true;
      pendingDirection = decision.direction!;
      pendingBetSize = decision.betSize!;
      pendingEntryPrice = decision.direction === 'UP' ? 0.50 : 0.50; // Simulated
      pendingRoundEndTime = Date.now() + 300000; // 5 min from now
      roundStartPrice = binanceWS.lastTradePrice;

      logger.trade('TradingLoop', `[PAPER] ${decision.action} $${decision.betSize?.toFixed(2)} — waiting for round end`);
      return;
    }

    if (mode === 'live') {
      // Live mode: send real order via backend
      hasOpenPosition = true;
      pendingDirection = decision.direction!;
      pendingBetSize = decision.betSize!;
      pendingEntryPrice = decision.direction === 'UP'
        ? (roundManager.getCurrentRound()?.priceUp ?? 0.50)
        : (roundManager.getCurrentRound()?.priceDown ?? 0.50);
      pendingRoundEndTime = roundManager.getCurrentRound()?.endTime ?? Date.now() + 300000;
      roundStartPrice = binanceWS.lastTradePrice;

      // Send order via API
      this.sendOrder(decision).catch(err => {
        logger.error('TradingLoop', `Order failed: ${err}`);
        hasOpenPosition = false;
      });
    }
  },

  async sendOrder(decision: Decision) {
    const round = roundManager.getCurrentRound();
    if (!round) throw new Error('No active round');

    const tokenId = decision.direction === 'UP' ? round.tokenIdUp : round.tokenIdDown;
    const price = decision.direction === 'UP' ? round.priceUp : round.priceDown;
    const size = Math.floor((decision.betSize ?? 0) / price);

    const res = await fetch('/api/polymarket/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenId, price, size, side: 'BUY' }),
    });

    if (!res.ok) {
      const err = await res.json();
      // Retry once with fresh price
      logger.warn('TradingLoop', `Order rejected, retrying... ${JSON.stringify(err)}`);
      const priceRes = await fetch(`/api/polymarket/price/${tokenId}`);
      if (priceRes.ok) {
        const newPrice = (await priceRes.json() as { price: number }).price;
        const retryRes = await fetch('/api/polymarket/order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tokenId, price: newPrice, size, side: 'BUY' }),
        });
        if (!retryRes.ok) {
          hasOpenPosition = false;
          throw new Error('Order rejected after retry');
        }
      }
    }

    logger.trade('TradingLoop', `[LIVE] Order placed: ${decision.action} ${size} contracts @ ${price}`);
  },

  resolveRound(callbacks: TradingLoopCallbacks) {
    if (!pendingDirection || !hasOpenPosition) return;

    const endPrice = binanceWS.lastTradePrice;
    const actualResult: 'UP' | 'DOWN' = endPrice >= roundStartPrice ? 'UP' : 'DOWN';
    const won = actualResult === pendingDirection;
    const pnl = won
      ? pendingBetSize * ((1 - pendingEntryPrice) / pendingEntryPrice)
      : pendingBetSize;

    bankrollManager.recordBet(won ? 'WIN' : 'LOSS', pnl);
    callbacks.onBankrollUpdate();

    logger.trade('TradingLoop',
      `Round resolved: ${actualResult} | Bet: ${pendingDirection} $${pendingBetSize.toFixed(2)} | ${won ? 'WIN' : 'LOSS'} ${won ? '+' : '-'}$${pnl.toFixed(2)} | BTC: ${roundStartPrice.toFixed(2)} → ${endPrice.toFixed(2)}`
    );

    // Save to DB
    this.saveTrainingRound(actualResult);

    // Reset
    hasOpenPosition = false;
    pendingDirection = null;
    pendingBetSize = 0;
    pendingEntryPrice = 0;
    pendingRoundEndTime = 0;
    roundStartPrice = 0;
  },

  async saveTrainingRound(result: 'UP' | 'DOWN') {
    const signal = signalEngine.getLastSignal();
    if (!signal) return;

    try {
      await fetch('/api/training-rounds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roundStartTime: new Date(Date.now() - 300000).toISOString(),
          roundEndTime: new Date().toISOString(),
          btcPriceStart: roundStartPrice,
          btcPriceEnd: binanceWS.lastTradePrice,
          actualResult: result,
          polymarketUpPrice: null,
          polymarketDownPrice: null,
          signalOrderbook: signal.signals.orderbook?.score ?? 0,
          signalEmaMacd: signal.signals.ema_macd?.score ?? 0,
          signalRsiStoch: signal.signals.rsi_stoch?.score ?? 0,
          signalVwapBb: signal.signals.vwap_bb?.score ?? 0,
          signalCvd: signal.signals.cvd?.score ?? 0,
          signalWhale: signal.signals.whale?.score ?? 0,
          signalFunding: signal.signals.funding?.score ?? 0,
          signalOpenInterest: signal.signals.open_interest?.score ?? 0,
          signalLiquidation: signal.signals.liquidation?.score ?? 0,
          signalLsRatio: signal.signals.ls_ratio?.score ?? 0,
          finalScore: signal.finalScore,
          confidence: signal.confidence,
          hypotheticalDecision: pendingDirection ? `BUY_${pendingDirection}` : 'SKIP',
          hypotheticalEv: 0,
          hypotheticalBetSize: pendingBetSize,
          hypotheticalPnl: 0,
        }),
      });
    } catch {
      // silent
    }
  },
};

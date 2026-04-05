import type { SignalResult, SignalName, CombinedSignal, SignalWeights, FuturesData } from '../types/index.js';
import { DEFAULT_WEIGHTS, SIGNAL_GROUPS } from '../types/signals.js';
import { sign } from '../utils/math.js';
import { logger } from '../utils/logger.js';
import { binanceWS } from '../websocket/BinanceWS.js';
import { streamManager } from '../websocket/StreamManager.js';

import { calculateOrderBookSignal } from './signals/OrderBookSignal.js';
import { calculateEmaMacdSignal } from './signals/EmaMacdSignal.js';
import { calculateRsiStochSignal } from './signals/RsiStochSignal.js';
import { calculateVwapBollingerSignal } from './signals/VwapBollingerSignal.js';
import { calculateCvdSignal } from './signals/CvdSignal.js';
import { calculateWhaleSignal } from './signals/WhaleSignal.js';
import { calculateFundingRateSignal } from './signals/FundingRateSignal.js';
import { calculateOpenInterestSignal } from './signals/OpenInterestSignal.js';
import { calculateLiquidationSignal } from './signals/LiquidationSignal.js';
import { calculateLsRatioSignal } from './signals/LsRatioSignal.js';

let currentWeights: SignalWeights = { ...DEFAULT_WEIGHTS };
let lastCombined: CombinedSignal | null = null;
let priceHistory5m: number[] = [];
let listeners: ((signal: CombinedSignal) => void)[] = [];

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function computeAllSignals(): Record<SignalName, SignalResult> {
  const closes = binanceWS.getCloses();
  const volumes = binanceWS.getVolumes();
  const currentPrice = binanceWS.lastTradePrice;
  const recentTrades2m = binanceWS.getRecentTrades(120000);
  const recentLiqs2m = binanceWS.getRecentLiquidations(120000);
  const futuresData: FuturesData = streamManager.getFuturesData();

  // Track 5m price history for OI signal
  priceHistory5m.push(currentPrice);
  if (priceHistory5m.length > 60) priceHistory5m.shift();
  const price5mAgo = priceHistory5m.length > 5 ? priceHistory5m[priceHistory5m.length - 6]! : currentPrice;

  return {
    orderbook: calculateOrderBookSignal(binanceWS.orderBook),
    ema_macd: calculateEmaMacdSignal(closes),
    rsi_stoch: calculateRsiStochSignal(closes),
    vwap_bb: calculateVwapBollingerSignal(closes, volumes, currentPrice),
    cvd: calculateCvdSignal(recentTrades2m, currentPrice),
    whale: calculateWhaleSignal(recentTrades2m),
    funding: calculateFundingRateSignal(futuresData),
    open_interest: calculateOpenInterestSignal(futuresData, currentPrice, price5mAgo),
    liquidation: calculateLiquidationSignal(recentLiqs2m),
    ls_ratio: calculateLsRatioSignal(futuresData),
  };
}

function combineSignals(signals: Record<SignalName, SignalResult>): CombinedSignal {
  // Weighted final score
  let finalScore = 0;
  const signalNames = Object.keys(signals) as SignalName[];
  for (const name of signalNames) {
    finalScore += signals[name]!.score * currentWeights[name];
  }

  // Confidence: agreement among signals
  const activeSigns = signalNames
    .filter(n => Math.abs(signals[n]!.score) > 10)
    .map(n => sign(signals[n]!.score));

  let confidence = 0;
  if (activeSigns.length > 0) {
    const majority = Math.max(
      activeSigns.filter(s => s === 1).length,
      activeSigns.filter(s => s === -1).length
    );
    const agreement = majority / activeSigns.length;
    confidence = Math.abs(finalScore) * agreement;
  }

  // Group scores
  const groupScores: Record<string, number> = {};
  for (const [group, names] of Object.entries(SIGNAL_GROUPS)) {
    const scores = names.map(n => signals[n]?.score ?? 0);
    groupScores[group] = mean(scores);
  }

  // Group agreement bonus
  const groupValues = Object.values(groupScores);
  const allGroupsAgree = groupValues.length > 0 &&
    groupValues.every(g => sign(g) === sign(finalScore) && g !== 0);
  if (allGroupsAgree) confidence *= 1.3;

  return {
    finalScore,
    confidence,
    signals,
    groupScores: groupScores as Record<string, number>,
    allGroupsAgree,
    timestamp: Date.now(),
  };
}

let calcInterval: ReturnType<typeof setInterval> | null = null;

export const signalEngine = {
  getLastSignal(): CombinedSignal | null {
    return lastCombined;
  },

  getWeights(): SignalWeights {
    return { ...currentWeights };
  },

  setWeights(weights: SignalWeights) {
    currentWeights = { ...weights };
    logger.info('SignalEngine', `Weights updated: ${JSON.stringify(weights)}`);
  },

  onSignal(listener: (signal: CombinedSignal) => void) {
    listeners.push(listener);
    return () => { listeners = listeners.filter(l => l !== listener); };
  },

  calculate(): CombinedSignal {
    const signals = computeAllSignals();
    const combined = combineSignals(signals);
    lastCombined = combined;
    for (const listener of listeners) listener(combined);
    return combined;
  },

  start(intervalMs: number = 1000) {
    logger.info('SignalEngine', `Starting signal engine (${intervalMs}ms interval)`);
    calcInterval = setInterval(() => {
      try {
        this.calculate();
      } catch (err) {
        logger.error('SignalEngine', `Calculation error: ${err}`);
      }
    }, intervalMs);
  },

  stop() {
    if (calcInterval) {
      clearInterval(calcInterval);
      calcInterval = null;
    }
    logger.info('SignalEngine', 'Signal engine stopped');
  },
};

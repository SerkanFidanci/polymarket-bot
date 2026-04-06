import { serverBinanceWS } from './binance-ws.js';
import { serverStreamManager } from './stream-manager.js';
import type { SignalResult, SignalName, CombinedSignal, SignalWeights, FuturesData } from '../src/types/index.js';
import { DEFAULT_WEIGHTS, SIGNAL_GROUPS } from '../src/types/signals.js';
import { sign } from '../src/utils/math.js';

import { calculateOrderBookSignal } from '../src/engine/signals/OrderBookSignal.js';
import { calculateEmaMacdSignal } from '../src/engine/signals/EmaMacdSignal.js';
import { calculateRsiStochSignal } from '../src/engine/signals/RsiStochSignal.js';
import { calculateVwapBollingerSignal } from '../src/engine/signals/VwapBollingerSignal.js';
import { calculateCvdSignal } from '../src/engine/signals/CvdSignal.js';
import { calculateWhaleSignal } from '../src/engine/signals/WhaleSignal.js';
import { calculateFundingRateSignal } from '../src/engine/signals/FundingRateSignal.js';
import { calculateOpenInterestSignal } from '../src/engine/signals/OpenInterestSignal.js';
import { calculateLiquidationSignal } from '../src/engine/signals/LiquidationSignal.js';
import { calculateLsRatioSignal } from '../src/engine/signals/LsRatioSignal.js';

let currentWeights: SignalWeights = { ...DEFAULT_WEIGHTS };
let lastCombined: CombinedSignal | null = null;
let priceHistory5m: number[] = [];
let calcInterval: ReturnType<typeof setInterval> | null = null;

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function computeAllSignals(): Record<SignalName, SignalResult> {
  const closes = serverBinanceWS.getCloses();
  const volumes = serverBinanceWS.getVolumes();
  const currentPrice = serverBinanceWS.lastTradePrice;
  const recentTrades2m = serverBinanceWS.getRecentTrades(120000);
  const recentLiqs2m = serverBinanceWS.getRecentLiquidations(120000);
  const futuresData: FuturesData = serverStreamManager.getFuturesData();

  priceHistory5m.push(currentPrice);
  if (priceHistory5m.length > 60) priceHistory5m.shift();
  const price5mAgo = priceHistory5m.length > 5 ? priceHistory5m[priceHistory5m.length - 6]! : currentPrice;

  return {
    orderbook: calculateOrderBookSignal(serverBinanceWS.orderBook),
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
  let finalScore = 0;
  const signalNames = Object.keys(signals) as SignalName[];
  for (const name of signalNames) {
    finalScore += signals[name]!.score * currentWeights[name];
  }

  // Confidence: normalized signal strength × agreement
  const activeSignalNames = signalNames
    .filter(n => Math.abs(signals[n]!.score) > 5);

  const avgAbsScore = activeSignalNames.length > 0
    ? activeSignalNames.reduce((sum, n) => sum + Math.abs(signals[n]!.score), 0) / activeSignalNames.length
    : 0;

  const majority = Math.max(
    activeSignalNames.filter(n => signals[n]!.score > 0).length,
    activeSignalNames.filter(n => signals[n]!.score < 0).length
  );
  const agreement = activeSignalNames.length > 0 ? majority / activeSignalNames.length : 0;

  // Normalize: confidence now ranges 0-70 in practice
  let confidence = (avgAbsScore / 100) * agreement * 100;

  // Bonus: 7+ signals agree → 30% boost
  if (activeSignalNames.length >= 7 && agreement > 0.8) confidence *= 1.3;

  // Min signal count: fewer than 3 active → confidence 0
  if (activeSignalNames.length < 3) confidence = 0;

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

export const serverSignalEngine = {
  getLastSignal(): CombinedSignal | null {
    return lastCombined;
  },

  getWeights(): SignalWeights {
    return { ...currentWeights };
  },

  setWeights(weights: SignalWeights) {
    currentWeights = { ...weights };
    console.log(`[ServerSignalEngine] Weights updated`);
  },

  calculate(): CombinedSignal {
    const signals = computeAllSignals();
    const combined = combineSignals(signals);
    lastCombined = combined;
    return combined;
  },

  start(intervalMs: number = 1000) {
    console.log(`[ServerSignalEngine] Starting signal engine (${intervalMs}ms interval)`);
    calcInterval = setInterval(() => {
      try {
        this.calculate();
      } catch (err) {
        console.error(`[ServerSignalEngine] Calculation error: ${err}`);
      }
    }, intervalMs);
  },

  stop() {
    if (calcInterval) {
      clearInterval(calcInterval);
      calcInterval = null;
    }
    console.log('[ServerSignalEngine] Signal engine stopped');
  },
};

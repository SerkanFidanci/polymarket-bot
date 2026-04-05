import type { SignalResult, Trade } from '../../types/index.js';
import { clamp, detectDivergence } from '../../utils/math.js';

const cvdHistory: number[] = [];
const priceHistory: number[] = [];

export function calculateCvdSignal(recentTrades: Trade[], currentPrice: number): SignalResult {
  if (recentTrades.length < 10) {
    return { name: 'cvd', score: 0, confidence: 0, timestamp: Date.now(), details: {} };
  }

  // Calculate CVD from trades
  let delta = 0;
  for (const trade of recentTrades) {
    if (trade.isBuyerMaker) {
      delta -= trade.quantity; // Seller aggressive
    } else {
      delta += trade.quantity; // Buyer aggressive
    }
  }

  cvdHistory.push(delta);
  priceHistory.push(currentPrice);
  if (cvdHistory.length > 60) { cvdHistory.shift(); priceHistory.shift(); }

  // CVD slope (last minute vs now)
  const cvdNow = delta;
  const cvd1mAgo = cvdHistory.length > 1 ? cvdHistory[cvdHistory.length - 2]! : 0;
  const cvdSlope = cvdNow - cvd1mAgo;

  // CVD divergence
  const cvdDivergence = detectDivergence(
    priceHistory.slice(-10),
    cvdHistory.slice(-10),
    Math.min(10, cvdHistory.length)
  );

  let cvdSignal = 0;
  if (cvdSlope > 0) cvdSignal = Math.min(cvdSlope * 10, 60);
  if (cvdSlope < 0) cvdSignal = Math.max(cvdSlope * 10, -60);

  if (cvdDivergence === 'bullish') cvdSignal += 40;
  if (cvdDivergence === 'bearish') cvdSignal -= 40;

  const score = clamp(cvdSignal, -100, 100);

  return {
    name: 'cvd',
    score,
    confidence: Math.abs(score),
    timestamp: Date.now(),
    details: {
      cvdNow: Math.round(delta * 1000) / 1000,
      cvdSlope: Math.round(cvdSlope * 1000) / 1000,
      divergence: cvdDivergence,
      buyVolume: Math.round(recentTrades.filter(t => !t.isBuyerMaker).reduce((s, t) => s + t.quantity, 0) * 1000) / 1000,
      sellVolume: Math.round(recentTrades.filter(t => t.isBuyerMaker).reduce((s, t) => s + t.quantity, 0) * 1000) / 1000,
    },
  };
}

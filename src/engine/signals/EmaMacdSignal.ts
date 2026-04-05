import type { SignalResult } from '../../types/index.js';
import { clamp, EMA, MACD } from '../../utils/math.js';

let prevHistogram = 0;

export function calculateEmaMacdSignal(closes: number[]): SignalResult {
  if (closes.length < 15) {
    return { name: 'ema_macd', score: 0, confidence: 0, timestamp: Date.now(), details: {} };
  }

  // EMA(5) vs EMA(13) crossover
  const ema5 = EMA(closes, 5);
  const ema13 = EMA(closes, 13);
  const prevCloses = closes.slice(0, -1);
  const ema5Prev = prevCloses.length >= 5 ? EMA(prevCloses, 5) : ema5;
  const ema13Prev = prevCloses.length >= 13 ? EMA(prevCloses, 13) : ema13;

  let emaSignal: number;
  if (ema5 > ema13 && ema5Prev <= ema13Prev) {
    emaSignal = 60; // Bullish cross
  } else if (ema5 < ema13 && ema5Prev >= ema13Prev) {
    emaSignal = -60; // Bearish cross
  } else {
    // Divergence strength
    emaSignal = ema13 === 0 ? 0 : ((ema5 - ema13) / ema13) * 10000;
  }
  emaSignal = clamp(emaSignal, -100, 100);

  // MACD (5, 13, 4) — scalping settings
  const macd = MACD(closes, 5, 13, 4);
  const histogram = macd.histogram;

  let macdSignal = 0;
  if (histogram > 0 && histogram > prevHistogram) macdSignal = 50;
  else if (histogram > 0 && histogram <= prevHistogram) macdSignal = 20;
  else if (histogram < 0 && histogram < prevHistogram) macdSignal = -50;
  else if (histogram < 0 && histogram >= prevHistogram) macdSignal = -20;

  prevHistogram = histogram;

  const score = clamp(emaSignal * 0.5 + macdSignal * 0.5, -100, 100);

  return {
    name: 'ema_macd',
    score,
    confidence: Math.abs(score),
    timestamp: Date.now(),
    details: {
      ema5: Math.round(ema5 * 100) / 100,
      ema13: Math.round(ema13 * 100) / 100,
      emaSignal: Math.round(emaSignal * 100) / 100,
      macdLine: Math.round(macd.macdLine * 100) / 100,
      signalLine: Math.round(macd.signalLine * 100) / 100,
      histogram: Math.round(histogram * 100) / 100,
      macdSignal,
    },
  };
}

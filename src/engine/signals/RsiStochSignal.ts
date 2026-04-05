import type { SignalResult } from '../../types/index.js';
import { clamp, RSI, StochasticRSI, detectDivergence } from '../../utils/math.js';

let prevStochK = 50;

export function calculateRsiStochSignal(closes: number[]): SignalResult {
  if (closes.length < 20) {
    return { name: 'rsi_stoch', score: 0, confidence: 0, timestamp: Date.now(), details: {} };
  }

  const rsi = RSI(closes, 14);
  const stoch = StochasticRSI(closes, 14, 14);
  const stochK = stoch.k;

  // RSI values for divergence detection
  const rsiValues: number[] = [];
  for (let i = 15; i <= closes.length; i++) {
    rsiValues.push(RSI(closes.slice(0, i), 14));
  }

  const divergence = detectDivergence(
    closes.slice(-10),
    rsiValues.slice(-10),
    10
  );

  let rsiSignal = 0;

  // Strong overbought/oversold
  if (rsi > 75 && stochK > 80) {
    rsiSignal = -80;
  } else if (rsi > 70) {
    rsiSignal = -(rsi - 70) * 3;
  } else if (rsi < 25 && stochK < 20) {
    rsiSignal = 80;
  } else if (rsi < 30) {
    rsiSignal = (30 - rsi) * 3;
  }
  // Moderate zones — give proportional signal
  else if (rsi > 60) {
    rsiSignal = -((rsi - 50) * 1.5); // 60 → -15, 70 → -30
  } else if (rsi < 40) {
    rsiSignal = (50 - rsi) * 1.5;    // 40 → +15, 30 → +30
  }
  // Near 50 — use stochastic for direction
  else {
    rsiSignal = (stochK - 50) * 0.3;  // -15 to +15 range
  }

  // Stochastic cross signals
  if (stochK > prevStochK && prevStochK < 30) {
    rsiSignal += 25; // Bullish stoch cross from oversold
  } else if (stochK < prevStochK && prevStochK > 70) {
    rsiSignal -= 25; // Bearish stoch cross from overbought
  }

  // Divergence
  if (divergence === 'bullish') rsiSignal += 40;
  if (divergence === 'bearish') rsiSignal -= 40;

  prevStochK = stochK;

  const score = clamp(rsiSignal, -100, 100);

  return {
    name: 'rsi_stoch',
    score,
    confidence: Math.abs(score),
    timestamp: Date.now(),
    details: {
      rsi: Math.round(rsi * 100) / 100,
      stochK: Math.round(stochK * 100) / 100,
      divergence,
      rsiSignal: Math.round(rsiSignal * 100) / 100,
    },
  };
}

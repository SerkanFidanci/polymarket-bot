import type { SignalResult, LiquidationEvent } from '../../types/index.js';
import { clamp } from '../../utils/math.js';

export function calculateLiquidationSignal(liquidations: LiquidationEvent[]): SignalResult {
  if (liquidations.length === 0) {
    return { name: 'liquidation', score: 0, confidence: 0, timestamp: Date.now(), details: {} };
  }

  // SELL side in forceOrder = long liquidation, BUY = short liquidation
  let longLiqVolume = 0;
  let shortLiqVolume = 0;

  for (const liq of liquidations) {
    const usdValue = liq.price * liq.quantity;
    if (liq.side === 'SELL') {
      longLiqVolume += usdValue;
    } else {
      shortLiqVolume += usdValue;
    }
  }

  const total = longLiqVolume + shortLiqVolume;

  if (total < 50000) {
    // Less than $50K liquidations → no signal
    return {
      name: 'liquidation',
      score: 0,
      confidence: 0,
      timestamp: Date.now(),
      details: { longLiqVolume: Math.round(longLiqVolume), shortLiqVolume: Math.round(shortLiqVolume), total: Math.round(total) },
    };
  }

  let score = 0;

  // Heavy long liquidations → more downside (cascade)
  if (longLiqVolume > shortLiqVolume * 3) {
    score = -60;
  } else if (longLiqVolume > shortLiqVolume * 1.5) {
    score = -30;
  }

  // Heavy short liquidations → short squeeze → UP
  if (shortLiqVolume > longLiqVolume * 3) {
    score = 60;
  } else if (shortLiqVolume > longLiqVolume * 1.5) {
    score = 30;
  }

  // Exhaustion detection: very large one-sided liq → trend might be ending
  if (longLiqVolume > 5000000) {
    score = 20; // Capitulation → bounce near
  }
  if (shortLiqVolume > 5000000) {
    score = -20; // Short squeeze exhaustion
  }

  score = clamp(score, -100, 100);

  return {
    name: 'liquidation',
    score,
    confidence: Math.abs(score),
    timestamp: Date.now(),
    details: {
      longLiqVolume: Math.round(longLiqVolume),
      shortLiqVolume: Math.round(shortLiqVolume),
      total: Math.round(total),
      liqCount: liquidations.length,
    },
  };
}

import type { SignalResult, Trade } from '../../types/index.js';
import { clamp } from '../../utils/math.js';
import { WHALE_THRESHOLD_BTC } from '../../utils/constants.js';

export function calculateWhaleSignal(recentTrades: Trade[]): SignalResult {
  // Filter big trades (> 0.5 BTC)
  const bigTrades = recentTrades.filter(t => t.quantity >= WHALE_THRESHOLD_BTC);

  if (bigTrades.length === 0) {
    return { name: 'whale', score: 0, confidence: 0, timestamp: Date.now(), details: { whaleCount: 0 } };
  }

  let buyScore = 0;
  let sellScore = 0;

  for (const trade of bigTrades) {
    const weight = Math.log2(trade.quantity / WHALE_THRESHOLD_BTC) + 1;
    if (trade.isBuyerMaker) {
      sellScore += weight; // Seller aggressive
    } else {
      buyScore += weight; // Buyer aggressive
    }
  }

  const total = buyScore + sellScore;
  const score = total === 0 ? 0 : clamp(((buyScore - sellScore) / total) * 100, -100, 100);

  return {
    name: 'whale',
    score,
    confidence: Math.min(Math.abs(score), 100),
    timestamp: Date.now(),
    details: {
      whaleCount: bigTrades.length,
      buyScore: Math.round(buyScore * 100) / 100,
      sellScore: Math.round(sellScore * 100) / 100,
      largestTrade: Math.round(Math.max(...bigTrades.map(t => t.quantity)) * 1000) / 1000,
    },
  };
}

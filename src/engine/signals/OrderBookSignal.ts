import type { SignalResult, OrderBook } from '../../types/index.js';
import { clamp, EMAIncremental } from '../../utils/math.js';

const EMA_HISTORY: number[] = [];
let prevEma = 0;

export function calculateOrderBookSignal(orderBook: OrderBook): SignalResult {
  const { bids, asks } = orderBook;

  if (bids.length === 0 || asks.length === 0) {
    return { name: 'orderbook', score: 0, confidence: 0, timestamp: Date.now(), details: {} };
  }

  // Weighted depth: closer levels matter more
  let weightedBid = 0;
  let weightedAsk = 0;
  for (let i = 0; i < Math.min(bids.length, 20); i++) {
    const weight = 1 / (i + 1);
    weightedBid += (bids[i]?.quantity ?? 0) * weight;
    weightedAsk += (asks[i]?.quantity ?? 0) * weight;
  }

  const total = weightedBid + weightedAsk;
  if (total === 0) {
    return { name: 'orderbook', score: 0, confidence: 0, timestamp: Date.now(), details: {} };
  }

  const imbalance = (weightedBid - weightedAsk) / total;

  // EMA smoothing (period 5)
  if (EMA_HISTORY.length === 0) {
    prevEma = imbalance;
  } else {
    prevEma = EMAIncremental(prevEma, imbalance, 5);
  }
  EMA_HISTORY.push(prevEma);
  if (EMA_HISTORY.length > 100) EMA_HISTORY.shift();

  const score = clamp(prevEma * 100, -100, 100);

  // Spread for additional context
  const bestBid = bids[0]?.price ?? 0;
  const bestAsk = asks[0]?.price ?? 0;
  const spread = bestAsk - bestBid;

  return {
    name: 'orderbook',
    score,
    confidence: Math.abs(score),
    timestamp: Date.now(),
    details: {
      weightedBid: Math.round(weightedBid * 100) / 100,
      weightedAsk: Math.round(weightedAsk * 100) / 100,
      imbalance: Math.round(imbalance * 10000) / 10000,
      spread: Math.round(spread * 100) / 100,
    },
  };
}

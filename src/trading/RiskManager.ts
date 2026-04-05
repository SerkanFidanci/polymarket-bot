import { logger } from '../utils/logger.js';
import { binanceWS } from '../websocket/BinanceWS.js';
import { isWeekendLowLiquidity } from '../utils/time.js';
import type { RiskConfig } from '../types/index.js';
import { DEFAULT_RISK_CONFIG } from '../types/bankroll.js';

export type MarketCondition = 'NORMAL' | 'HIGH_VOLATILITY' | 'LOW_VOLATILITY' | 'LOW_LIQUIDITY' | 'FAST_MOVING' | 'MANIPULATION_SUSPECT';

interface RiskState {
  condition: MarketCondition;
  volatility1m: number;
  volatility5m: number;
  spreadBps: number;
  skipRoundsRemaining: number;
  cautionRoundsRemaining: number;
  lastConditionChange: number;
}

const state: RiskState = {
  condition: 'NORMAL',
  volatility1m: 0,
  volatility5m: 0,
  spreadBps: 0,
  skipRoundsRemaining: 0,
  cautionRoundsRemaining: 0,
  lastConditionChange: 0,
};

let config: RiskConfig = { ...DEFAULT_RISK_CONFIG };
let lastLoggedCondition: MarketCondition = 'NORMAL';

export const riskManager = {
  getState(): RiskState {
    return { ...state };
  },

  setConfig(c: Partial<RiskConfig>) {
    config = { ...config, ...c };
  },

  update() {
    const klines = binanceWS.klines;
    const orderBook = binanceWS.orderBook;

    // 1-minute volatility
    if (klines.length >= 2) {
      const last = klines[klines.length - 1]!;
      const prev = klines[klines.length - 2]!;
      state.volatility1m = prev.close > 0 ? Math.abs((last.close - prev.close) / prev.close) : 0;
    }

    // 5-minute volatility
    if (klines.length >= 6) {
      const last = klines[klines.length - 1]!;
      const fiveAgo = klines[klines.length - 6]!;
      state.volatility5m = fiveAgo.close > 0 ? Math.abs((last.close - fiveAgo.close) / fiveAgo.close) : 0;
    }

    // Spread
    if (orderBook.bids.length > 0 && orderBook.asks.length > 0) {
      const bestBid = orderBook.bids[0]!.price;
      const bestAsk = orderBook.asks[0]!.price;
      const mid = (bestBid + bestAsk) / 2;
      state.spreadBps = mid > 0 ? ((bestAsk - bestBid) / mid) * 10000 : 0;
    }

    // Determine market condition
    const prevCondition = state.condition;

    if (state.volatility1m > config.highVolatilityThreshold) {
      state.condition = 'HIGH_VOLATILITY';
    } else if (isWeekendLowLiquidity()) {
      state.condition = 'LOW_LIQUIDITY';
    } else if (klines.length >= 6 && state.volatility5m < 0.00005) {
      state.condition = 'LOW_VOLATILITY';
    } else {
      state.condition = 'NORMAL';
    }

    // Manipulation detection — stricter thresholds to avoid false positives
    // Only trigger if top-of-book bid OR ask has >70% of top-5 levels AND spread is unusually wide
    if (orderBook.bids.length >= 5 && orderBook.asks.length >= 5) {
      const top5BidQty = orderBook.bids.slice(0, 5).reduce((s, b) => s + b.quantity, 0);
      const largestBid = Math.max(...orderBook.bids.slice(0, 5).map(b => b.quantity));
      const top5AskQty = orderBook.asks.slice(0, 5).reduce((s, a) => s + a.quantity, 0);
      const largestAsk = Math.max(...orderBook.asks.slice(0, 5).map(a => a.quantity));

      const bidDominance = top5BidQty > 0 ? largestBid / top5BidQty : 0;
      const askDominance = top5AskQty > 0 ? largestAsk / top5AskQty : 0;

      if ((bidDominance > 0.7 || askDominance > 0.7) && state.spreadBps > 5) {
        state.condition = 'MANIPULATION_SUSPECT';
        state.skipRoundsRemaining = 1;
        state.cautionRoundsRemaining = 2;
      }
    }

    // Only log when condition ACTUALLY changes (prevents spam)
    if (state.condition !== lastLoggedCondition) {
      logger.info('Risk', `Market condition: ${lastLoggedCondition} → ${state.condition}`);
      lastLoggedCondition = state.condition;
      state.lastConditionChange = Date.now();
    }

    // Decrement skip/caution counters (only when condition changes, not every tick)
    if (state.condition !== prevCondition) {
      if (state.skipRoundsRemaining > 0) state.skipRoundsRemaining--;
      if (state.cautionRoundsRemaining > 0) state.cautionRoundsRemaining--;
    }
  },

  shouldSkip(): { skip: boolean; reason: string } {
    if (state.skipRoundsRemaining > 0) {
      return { skip: true, reason: `Skip rounds remaining: ${state.skipRoundsRemaining}` };
    }
    return { skip: false, reason: '' };
  },

  isHighVolatility(): boolean {
    return state.condition === 'HIGH_VOLATILITY';
  },

  isLowLiquidity(): boolean {
    return state.condition === 'LOW_LIQUIDITY' || isWeekendLowLiquidity();
  },

  getConfidenceMultiplier(): number {
    if (state.condition === 'HIGH_VOLATILITY') return 0.5;
    if (state.condition === 'MANIPULATION_SUSPECT') return 0.3;
    if (state.cautionRoundsRemaining > 0) return 0.7;
    return 1.0;
  },

  getBetSizeMultiplier(): number {
    if (state.condition === 'HIGH_VOLATILITY') return 0.5;
    if (state.condition === 'LOW_LIQUIDITY') return 0.5;
    if (state.condition === 'LOW_VOLATILITY') return 0.7;
    if (state.cautionRoundsRemaining > 0) return 0.5;
    return 1.0;
  },
};

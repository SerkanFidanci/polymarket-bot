import { serverBinanceWS } from './binance-ws.js';
import { serverSignalEngine } from './signal-engine.js';
import {
  ABSOLUTE_STOP, ABSOLUTE_TARGET,
  STOP_LOSS_PCT, TAKE_PROFIT_PCT,
  TREND_REVERSAL_BTC_PCT, TREND_REVERSAL_DURATION_MS,
  SIGNAL_FLIP_THRESHOLD,
  TIME_EXIT_60S_MIN, TIME_EXIT_60S_MAX, TIME_EXIT_30S_MIN,
  VOLATILITY_SPIKE_BTC_PCT,
  TRAILING_STOP_PCT,
} from '../src/utils/constants.js';

export interface OpenPosition {
  direction: 'UP' | 'DOWN';
  entryPrice: number;       // Token entry price (e.g. 0.45)
  betSize: number;           // Dollar amount
  btcEntryPrice: number;     // BTC price at entry
  roundEndTime: number;      // When round expires (ms)
  peakTokenPrice: number;    // Highest token price seen (for trailing stop)
}

export interface ExitResult {
  shouldExit: boolean;
  reason: string;
  exitPrice: number;
  pnl: number;
  priority: number;          // Lower = higher priority
}

// BTC price history for trend detection
const btcPriceHistory: Array<{ price: number; time: number }> = [];
const MAX_HISTORY = 60; // 60 entries × 5s = 5 minutes

export function recordBtcPrice(price: number): void {
  btcPriceHistory.push({ price, time: Date.now() });
  if (btcPriceHistory.length > MAX_HISTORY) btcPriceHistory.shift();
}

function getBtcPriceAgo(ms: number): number {
  const cutoff = Date.now() - ms;
  for (let i = btcPriceHistory.length - 1; i >= 0; i--) {
    if (btcPriceHistory[i]!.time <= cutoff) return btcPriceHistory[i]!.price;
  }
  return btcPriceHistory[0]?.price ?? serverBinanceWS.lastTradePrice;
}

export function evaluateExitConditions(
  pos: OpenPosition,
  currentTokenPrice: number,
): ExitResult {
  const now = Date.now();
  const timeLeftMs = pos.roundEndTime - now;
  const timeLeftSec = Math.max(0, Math.floor(timeLeftMs / 1000));
  const btcNow = serverBinanceWS.lastTradePrice;
  const shares = pos.betSize / pos.entryPrice;

  // Helper: calculate PnL from exit
  const calcPnl = (exitPrice: number) => (exitPrice - pos.entryPrice) * shares;

  // Update peak price for trailing stop
  if (currentTokenPrice > pos.peakTokenPrice) {
    pos.peakTokenPrice = currentTokenPrice;
  }

  // ═══ PRIORITY 1: VOLATILITY SPIKE ═══
  const btc30sAgo = getBtcPriceAgo(TREND_REVERSAL_DURATION_MS);
  if (btc30sAgo > 0) {
    const btcChange = Math.abs(btcNow - btc30sAgo) / btc30sAgo;
    if (btcChange >= VOLATILITY_SPIKE_BTC_PCT) {
      return {
        shouldExit: true,
        reason: `volatility_spike (BTC ${(btcChange * 100).toFixed(2)}% in 30s)`,
        exitPrice: currentTokenPrice,
        pnl: calcPnl(currentTokenPrice),
        priority: 1,
      };
    }
  }

  // ═══ PRIORITY 2: ABSOLUTE STOP-LOSS ═══
  if (currentTokenPrice < ABSOLUTE_STOP) {
    return {
      shouldExit: true,
      reason: `absolute_stop (token ${(currentTokenPrice * 100).toFixed(0)}¢ < ${ABSOLUTE_STOP * 100}¢)`,
      exitPrice: currentTokenPrice,
      pnl: calcPnl(currentTokenPrice),
      priority: 2,
    };
  }

  // ═══ PRIORITY 3: ABSOLUTE TAKE-PROFIT ═══
  if (currentTokenPrice > ABSOLUTE_TARGET) {
    return {
      shouldExit: true,
      reason: `absolute_target (token ${(currentTokenPrice * 100).toFixed(0)}¢ > ${ABSOLUTE_TARGET * 100}¢)`,
      exitPrice: currentTokenPrice,
      pnl: calcPnl(currentTokenPrice),
      priority: 3,
    };
  }

  // ═══ PRIORITY 4: TREND REVERSAL ═══
  if (btc30sAgo > 0) {
    const btcChangeDir = (btcNow - btc30sAgo) / btc30sAgo;
    const posAgainst = (pos.direction === 'UP' && btcChangeDir < -TREND_REVERSAL_BTC_PCT)
      || (pos.direction === 'DOWN' && btcChangeDir > TREND_REVERSAL_BTC_PCT);
    if (posAgainst) {
      return {
        shouldExit: true,
        reason: `trend_reversal (BTC ${btcChangeDir > 0 ? '+' : ''}${(btcChangeDir * 100).toFixed(2)}% vs ${pos.direction})`,
        exitPrice: currentTokenPrice,
        pnl: calcPnl(currentTokenPrice),
        priority: 4,
      };
    }
  }

  // ═══ PRIORITY 5: SIGNAL FLIP ═══
  const signal = serverSignalEngine.getLastSignal();
  if (signal) {
    const flipAgainst = (pos.direction === 'UP' && signal.finalScore < -SIGNAL_FLIP_THRESHOLD)
      || (pos.direction === 'DOWN' && signal.finalScore > SIGNAL_FLIP_THRESHOLD);
    if (flipAgainst) {
      return {
        shouldExit: true,
        reason: `signal_flip (score ${signal.finalScore.toFixed(1)} vs ${pos.direction})`,
        exitPrice: currentTokenPrice,
        pnl: calcPnl(currentTokenPrice),
        priority: 5,
      };
    }
  }

  // ═══ PRIORITY 6: TRAILING STOP ═══
  if (pos.peakTokenPrice > pos.entryPrice) {
    const dropFromPeak = (pos.peakTokenPrice - currentTokenPrice) / pos.peakTokenPrice;
    if (dropFromPeak >= TRAILING_STOP_PCT) {
      return {
        shouldExit: true,
        reason: `trailing_stop (peak ${(pos.peakTokenPrice * 100).toFixed(0)}¢ → ${(currentTokenPrice * 100).toFixed(0)}¢, -${(dropFromPeak * 100).toFixed(0)}%)`,
        exitPrice: currentTokenPrice,
        pnl: calcPnl(currentTokenPrice),
        priority: 6,
      };
    }
  }

  // ═══ PRIORITY 7: TIME EXIT (30s left) ═══
  if (timeLeftSec <= 30 && currentTokenPrice < TIME_EXIT_30S_MIN) {
    return {
      shouldExit: true,
      reason: `time_30s (${timeLeftSec}s left, token ${(currentTokenPrice * 100).toFixed(0)}¢ < ${TIME_EXIT_30S_MIN * 100}¢)`,
      exitPrice: currentTokenPrice,
      pnl: calcPnl(currentTokenPrice),
      priority: 7,
    };
  }

  // ═══ PRIORITY 8: TIME EXIT (60s left) ═══
  if (timeLeftSec <= 60 && timeLeftSec > 30) {
    if (currentTokenPrice < TIME_EXIT_60S_MIN || (currentTokenPrice >= TIME_EXIT_60S_MIN && currentTokenPrice <= TIME_EXIT_60S_MAX)) {
      return {
        shouldExit: true,
        reason: `time_60s (${timeLeftSec}s left, token ${(currentTokenPrice * 100).toFixed(0)}¢ in uncertain zone)`,
        exitPrice: currentTokenPrice,
        pnl: calcPnl(currentTokenPrice),
        priority: 8,
      };
    }
  }

  // ═══ PRIORITY 9: PRICE TAKE-PROFIT ═══
  if (currentTokenPrice >= pos.entryPrice * TAKE_PROFIT_PCT) {
    return {
      shouldExit: true,
      reason: `take_profit (${(currentTokenPrice / pos.entryPrice * 100).toFixed(0)}% of entry)`,
      exitPrice: currentTokenPrice,
      pnl: calcPnl(currentTokenPrice),
      priority: 9,
    };
  }

  // ═══ PRIORITY 10: PRICE STOP-LOSS ═══
  if (currentTokenPrice <= pos.entryPrice * STOP_LOSS_PCT) {
    return {
      shouldExit: true,
      reason: `price_stop (${(currentTokenPrice / pos.entryPrice * 100).toFixed(0)}% of entry)`,
      exitPrice: currentTokenPrice,
      pnl: calcPnl(currentTokenPrice),
      priority: 10,
    };
  }

  // No exit
  return {
    shouldExit: false,
    reason: 'hold',
    exitPrice: currentTokenPrice,
    pnl: calcPnl(currentTokenPrice),
    priority: 99,
  };
}

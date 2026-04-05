// ===== BASIC MATH =====

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function sign(x: number): number {
  if (x > 0) return 1;
  if (x < 0) return -1;
  return 0;
}

// ===== MOVING AVERAGES =====

export function SMA(values: number[], period: number): number {
  if (values.length < period) return values.length > 0 ? values[values.length - 1]! : 0;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function EMA(values: number[], period: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0]!;

  const multiplier = 2 / (period + 1);
  let ema = values[0]!;
  for (let i = 1; i < values.length; i++) {
    ema = (values[i]! - ema) * multiplier + ema;
  }
  return ema;
}

export function EMAIncremental(prevEma: number, newValue: number, period: number): number {
  const multiplier = 2 / (period + 1);
  return (newValue - prevEma) * multiplier + prevEma;
}

// ===== VOLATILITY =====

export function STDEV(values: number[], period: number): number {
  if (values.length < 2) return 0;
  const slice = values.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const variance = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / slice.length;
  return Math.sqrt(variance);
}

// ===== RSI =====

export function RSI(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50;

  let avgGain = 0;
  let avgLoss = 0;

  // Initial average
  for (let i = 1; i <= period; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  // Smoothed
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ===== STOCHASTIC =====

export function Stochastic(values: number[], period: number = 14): number {
  if (values.length < period) return 50;
  const slice = values.slice(-period);
  const high = Math.max(...slice);
  const low = Math.min(...slice);
  if (high === low) return 50;
  const current = slice[slice.length - 1]!;
  return ((current - low) / (high - low)) * 100;
}

export function StochasticRSI(closes: number[], rsiPeriod: number = 14, stochPeriod: number = 14): { k: number; d: number } {
  if (closes.length < rsiPeriod + stochPeriod + 1) return { k: 50, d: 50 };

  // Calculate RSI values for stoch period
  const rsiValues: number[] = [];
  for (let i = rsiPeriod + 1; i <= closes.length; i++) {
    rsiValues.push(RSI(closes.slice(0, i), rsiPeriod));
  }

  const k = Stochastic(rsiValues, stochPeriod);
  // Simple %D = 3-period SMA of %K (we approximate with single value)
  const d = k; // Will be smoothed over time with rolling window
  return { k, d };
}

// ===== MACD =====

export interface MACDResult {
  macdLine: number;
  signalLine: number;
  histogram: number;
}

export function MACD(closes: number[], fast: number = 5, slow: number = 13, signal: number = 4): MACDResult {
  if (closes.length < slow + signal) {
    return { macdLine: 0, signalLine: 0, histogram: 0 };
  }

  const emaFast = EMA(closes, fast);
  const emaSlow = EMA(closes, slow);
  const macdLine = emaFast - emaSlow;

  // Calculate MACD line history for signal line
  const macdHistory: number[] = [];
  for (let i = slow; i <= closes.length; i++) {
    const slice = closes.slice(0, i);
    macdHistory.push(EMA(slice, fast) - EMA(slice, slow));
  }

  const signalLine = EMA(macdHistory, signal);
  const histogram = macdLine - signalLine;

  return { macdLine, signalLine, histogram };
}

// ===== VWAP =====

export function VWAP(prices: number[], volumes: number[]): number {
  if (prices.length === 0 || prices.length !== volumes.length) return 0;
  let cumPV = 0;
  let cumV = 0;
  for (let i = 0; i < prices.length; i++) {
    cumPV += prices[i]! * volumes[i]!;
    cumV += volumes[i]!;
  }
  return cumV === 0 ? prices[prices.length - 1]! : cumPV / cumV;
}

// ===== BOLLINGER BANDS =====

export interface BollingerBands {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number;
  position: number; // 0-1 (where price sits within bands)
}

export function BollingerBands(closes: number[], period: number = 20, stdMult: number = 2): BollingerBands {
  const middle = SMA(closes, period);
  const std = STDEV(closes, period);
  const upper = middle + stdMult * std;
  const lower = middle - stdMult * std;
  const bandwidth = middle === 0 ? 0 : (upper - lower) / middle;
  const current = closes[closes.length - 1] ?? middle;
  const position = upper === lower ? 0.5 : (current - lower) / (upper - lower);

  return { upper, middle, lower, bandwidth, position };
}

// ===== DIVERGENCE DETECTION =====

export type DivergenceType = 'bullish' | 'bearish' | 'none';

export function detectDivergence(
  prices: number[],
  indicator: number[],
  lookback: number = 10
): DivergenceType {
  if (prices.length < lookback || indicator.length < lookback) return 'none';

  const pSlice = prices.slice(-lookback);
  const iSlice = indicator.slice(-lookback);

  // Find local extremes
  const pMin = Math.min(...pSlice);
  const pMax = Math.max(...pSlice);
  const pMinIdx = pSlice.indexOf(pMin);
  const pMaxIdx = pSlice.indexOf(pMax);

  const currentP = pSlice[pSlice.length - 1]!;
  const currentI = iSlice[iSlice.length - 1]!;

  // Bullish divergence: price makes new low but indicator makes higher low
  if (pMinIdx >= lookback - 3) { // Recent low
    const prevLows = pSlice.slice(0, lookback - 3);
    const prevIndicatorAtLow = iSlice.slice(0, lookback - 3);
    if (prevLows.length > 0) {
      const prevMinP = Math.min(...prevLows);
      const prevMinPIdx = prevLows.indexOf(prevMinP);
      if (currentP <= prevMinP && currentI > (prevIndicatorAtLow[prevMinPIdx] ?? 0)) {
        return 'bullish';
      }
    }
  }

  // Bearish divergence: price makes new high but indicator makes lower high
  if (pMaxIdx >= lookback - 3) {
    const prevHighs = pSlice.slice(0, lookback - 3);
    const prevIndicatorAtHigh = iSlice.slice(0, lookback - 3);
    if (prevHighs.length > 0) {
      const prevMaxP = Math.max(...prevHighs);
      const prevMaxPIdx = prevHighs.indexOf(prevMaxP);
      if (currentP >= prevMaxP && currentI < (prevIndicatorAtHigh[prevMaxPIdx] ?? 0)) {
        return 'bearish';
      }
    }
  }

  return 'none';
}

// ===== CVD (Cumulative Volume Delta) =====

export function calculateCVD(trades: { quantity: number; isBuyerMaker: boolean }[]): number {
  let delta = 0;
  for (const trade of trades) {
    if (trade.isBuyerMaker) {
      delta -= trade.quantity; // Seller aggressive
    } else {
      delta += trade.quantity; // Buyer aggressive
    }
  }
  return delta;
}

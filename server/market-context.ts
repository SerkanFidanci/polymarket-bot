/**
 * Market Context — multi-timeframe trend, volatility, round patterns
 * Sinyallerin eksik olduğu büyük resmi sağlar
 */

import { db } from './db/sqlite.js';
import { serverBinanceWS } from './binance-ws.js';

// ===== MULTI-TIMEFRAME =====

interface TimeframeTrend {
  direction: 'UP' | 'DOWN' | 'FLAT';
  strength: number; // 0-100
  emaFast: number;
  emaSlow: number;
}

let trend5m: TimeframeTrend = { direction: 'FLAT', strength: 0, emaFast: 0, emaSlow: 0 };
let trend15m: TimeframeTrend = { direction: 'FLAT', strength: 0, emaFast: 0, emaSlow: 0 };
let atr14: number = 0; // 14-period ATR from 5m candles

function ema(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const mult = 2 / (period + 1);
  let e = values[0]!;
  for (let i = 1; i < values.length; i++) e = (values[i]! - e) * mult + e;
  return e;
}

function computeTrend(closes: number[]): TimeframeTrend {
  if (closes.length < 10) return { direction: 'FLAT', strength: 0, emaFast: 0, emaSlow: 0 };
  const fast = ema(closes, 5);
  const slow = ema(closes, 13);
  const diff = fast - slow;
  const pct = slow > 0 ? Math.abs(diff / slow) * 100 : 0;
  const direction = diff > 0 ? 'UP' : diff < 0 ? 'DOWN' : 'FLAT';
  return { direction: pct < 0.01 ? 'FLAT' : direction, strength: Math.min(100, pct * 50), emaFast: fast, emaSlow: slow };
}

function computeATR(klines: Array<{ high: number; low: number; close: number }>): number {
  if (klines.length < 15) return 0;
  let atr = 0;
  for (let i = 1; i < Math.min(klines.length, 15); i++) {
    const tr = Math.max(
      klines[i]!.high - klines[i]!.low,
      Math.abs(klines[i]!.high - klines[i - 1]!.close),
      Math.abs(klines[i]!.low - klines[i - 1]!.close)
    );
    atr = i === 1 ? tr : (atr * 13 + tr) / 14;
  }
  return atr;
}

async function fetchKlines(interval: string, limit: number): Promise<Array<{ open: number; high: number; low: number; close: number; volume: number }>> {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`);
    if (!res.ok) return [];
    const data = await res.json() as (string | number)[][];
    return data.map(k => ({
      open: parseFloat(k[1] as string),
      high: parseFloat(k[2] as string),
      low: parseFloat(k[3] as string),
      close: parseFloat(k[4] as string),
      volume: parseFloat(k[5] as string),
    }));
  } catch { return []; }
}

async function updateMultiTimeframe(): Promise<void> {
  const [klines5m, klines15m] = await Promise.all([
    fetchKlines('5m', 20),
    fetchKlines('15m', 20),
  ]);

  if (klines5m.length > 0) {
    trend5m = computeTrend(klines5m.map(k => k.close));
    atr14 = computeATR(klines5m);
  }
  if (klines15m.length > 0) {
    trend15m = computeTrend(klines15m.map(k => k.close));
  }
}

// ===== ROUND PATTERN =====

interface RoundPattern {
  lastResults: string[];     // son 10 round: ['UP','DOWN','UP',...]
  upStreak: number;          // ardışık UP sayısı
  downStreak: number;        // ardışık DOWN sayısı
  recentUpPct: number;       // son 20 round'da UP yüzdesi
  meanReversionSignal: 'UP' | 'DOWN' | 'NONE'; // mean reversion sinyali
}

function getRoundPattern(): RoundPattern {
  try {
    const rows = db.prepare("SELECT actual_result FROM training_rounds ORDER BY id DESC LIMIT 20").all() as Array<{ actual_result: string }>;
    if (rows.length === 0) return { lastResults: [], upStreak: 0, downStreak: 0, recentUpPct: 50, meanReversionSignal: 'NONE' };

    const results = rows.map(r => r.actual_result).reverse(); // oldest first
    const last10 = results.slice(-10);

    // Streak
    let upStreak = 0, downStreak = 0;
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i] === 'UP' && downStreak === 0) upStreak++;
      else if (results[i] === 'DOWN' && upStreak === 0) downStreak++;
      else break;
    }

    // Recent UP percentage
    const ups = results.filter(r => r === 'UP').length;
    const recentUpPct = (ups / results.length) * 100;

    // Mean reversion: 4+ streak → expect reversal
    let meanReversionSignal: 'UP' | 'DOWN' | 'NONE' = 'NONE';
    if (downStreak >= 4) meanReversionSignal = 'UP';   // çok DOWN geldi → UP beklenir
    if (upStreak >= 4) meanReversionSignal = 'DOWN';    // çok UP geldi → DOWN beklenir

    return { lastResults: last10, upStreak, downStreak, recentUpPct, meanReversionSignal };
  } catch {
    return { lastResults: [], upStreak: 0, downStreak: 0, recentUpPct: 50, meanReversionSignal: 'NONE' };
  }
}

// ===== VOLATİLİTE =====

interface VolatilityContext {
  atr: number;                // 14-period ATR (5m candles)
  atrPct: number;             // ATR as % of price
  isLowVol: boolean;          // düşük volatilite (tahmin zor)
  isHighVol: boolean;         // yüksek volatilite (güçlü hareket)
  bbWidth: number;            // Bollinger Band width from 1m
}

function getVolatility(): VolatilityContext {
  const price = serverBinanceWS.lastTradePrice;
  const atrPct = price > 0 ? (atr14 / price) * 100 : 0;

  // BB width from 1m klines
  const closes = serverBinanceWS.getCloses();
  let bbWidth = 0;
  if (closes.length >= 20) {
    const slice = closes.slice(-20);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const std = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / slice.length);
    bbWidth = mean > 0 ? (4 * std / mean) * 100 : 0; // % width
  }

  return {
    atr: atr14,
    atrPct,
    isLowVol: atrPct < 0.05,   // ATR < %0.05 = çok sakin
    isHighVol: atrPct > 0.15,   // ATR > %0.15 = volatil
    bbWidth,
  };
}

// ===== COMBINED CONTEXT =====

export interface MarketContext {
  trend5m: TimeframeTrend;
  trend15m: TimeframeTrend;
  roundPattern: RoundPattern;
  volatility: VolatilityContext;
  trendsAgree: boolean;        // 5m ve 15m aynı yönde mi?
  trendDirection: 'UP' | 'DOWN' | 'MIXED';
}

export function getMarketContext(): MarketContext {
  const pattern = getRoundPattern();
  const vol = getVolatility();
  const trendsAgree = trend5m.direction === trend15m.direction && trend5m.direction !== 'FLAT';

  return {
    trend5m,
    trend15m,
    roundPattern: pattern,
    volatility: vol,
    trendsAgree,
    trendDirection: trendsAgree ? trend5m.direction : 'MIXED',
  };
}

// ===== START POLLING =====

let pollInterval: ReturnType<typeof setInterval> | null = null;

export function startMarketContext(): void {
  updateMultiTimeframe();
  pollInterval = setInterval(updateMultiTimeframe, 30000); // 30s'de bir güncelle
  console.log('[MarketContext] Started — 5m/15m trend + ATR polling (30s)');
}

export function stopMarketContext(): void {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

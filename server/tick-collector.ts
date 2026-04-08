/**
 * Tick Collector — round boyunca saniye saniye veri kaydeder
 * Sinyal analizi ve optimizasyon için tarihsel veri
 */

import { db } from './db/sqlite.js';
import { serverBinanceWS } from './binance-ws.js';
import { serverSignalEngine } from './signal-engine.js';
import { getBtcMomentum, getPmMomentum } from './momentum-tracker.js';
import { getMarketContext } from './market-context.js';

let currentSlug = '';
let roundStartTime = 0;
let collectInterval: ReturnType<typeof setInterval> | null = null;
let tickCount = 0;

const insertStmt = db.prepare(`
  INSERT INTO round_ticks (
    round_slug, timestamp, seconds_into_round, btc_price, pm_up, pm_down,
    combined_score, confidence,
    sig_orderbook, sig_ema_macd, sig_rsi_stoch, sig_vwap_bb,
    sig_cvd, sig_whale, sig_funding, sig_oi, sig_ls_ratio,
    btc_momentum_10s, btc_momentum_30s, pm_momentum_30s,
    trend_5m, trend_15m, atr
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function collectTick(): void {
  if (!currentSlug) return;

  const signal = serverSignalEngine.getLastSignal();
  if (!signal) return;

  const btcMom10 = getBtcMomentum(10);
  const btcMom30 = getBtcMomentum(30);
  const pmMom30 = getPmMomentum(30);
  const ctx = getMarketContext();

  const secIntoRound = Math.floor((Date.now() - roundStartTime) / 1000);

  try {
    insertStmt.run(
      currentSlug,
      new Date().toISOString(),
      secIntoRound,
      serverBinanceWS.lastTradePrice,
      lastPmUp, lastPmDown,
      signal.finalScore,
      signal.confidence,
      signal.signals.orderbook?.score ?? 0,
      signal.signals.ema_macd?.score ?? 0,
      signal.signals.rsi_stoch?.score ?? 0,
      signal.signals.vwap_bb?.score ?? 0,
      signal.signals.cvd?.score ?? 0,
      signal.signals.whale?.score ?? 0,
      signal.signals.funding?.score ?? 0,
      signal.signals.open_interest?.score ?? 0,
      signal.signals.ls_ratio?.score ?? 0,
      btcMom10?.changePct ?? 0,
      btcMom30?.changePct ?? 0,
      pmMom30?.change ?? 0,
      ctx.trend5m.direction,
      ctx.trend15m.direction,
      ctx.volatility.atr,
    );
    tickCount++;
  } catch { /* silent — don't break trading loop */ }
}

// PM fiyatlarını güncelle (ayrı çağrılır çünkü farklı interval)
let lastPmUp = 0;
let lastPmDown = 0;

export function setTickPrices(up: number, down: number): void {
  lastPmUp = up;
  lastPmDown = down;
}

export function startTickCollector(): void {
  // Her 5 saniyede bir tick kaydet (1s çok fazla DB yazması olur)
  collectInterval = setInterval(collectTick, 5000);
  console.log('[TickCollector] Started — recording every 5s');
}

export function stopTickCollector(): void {
  if (collectInterval) { clearInterval(collectInterval); collectInterval = null; }
}

export function setCurrentRound(slug: string, startTime: number): void {
  if (slug !== currentSlug) {
    if (currentSlug) {
      console.log(`[TickCollector] Round ${currentSlug} ended — ${tickCount} ticks recorded`);
    }
    currentSlug = slug;
    roundStartTime = startTime;
    tickCount = 0;
  }
}

// PM fiyatlarını update et (collectTick'te kullanılacak)
// insertStmt'da pm_up/pm_down 0 olarak giriliyor — bunu düzelt
// Aslında direkt global değerleri kullanalım
export function getTickStats(): { totalTicks: number; currentSlug: string } {
  const total = db.prepare('SELECT COUNT(*) as c FROM round_ticks').get() as { c: number };
  return { totalTicks: total.c, currentSlug };
}

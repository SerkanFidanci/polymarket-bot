/**
 * Momentum Tracker — saniye bazlı BTC ve PM fiyat geçmişi
 * Spike tespiti, momentum hesabı, oracle lag tespiti
 */

interface PriceTick {
  price: number;
  time: number; // ms
}

const BTC_HISTORY: PriceTick[] = [];
const PM_UP_HISTORY: PriceTick[] = [];
const MAX_TICKS = 300; // 5 dakika (1 tick/saniye)

// ===== KAYIT =====

export function recordBtcTick(price: number): void {
  if (price <= 0) return;
  BTC_HISTORY.push({ price, time: Date.now() });
  if (BTC_HISTORY.length > MAX_TICKS) BTC_HISTORY.shift();
}

export function recordPmTick(upPrice: number): void {
  if (upPrice <= 0 || upPrice >= 1) return;
  PM_UP_HISTORY.push({ price: upPrice, time: Date.now() });
  if (PM_UP_HISTORY.length > MAX_TICKS) PM_UP_HISTORY.shift();
}

// ===== MOMENTUM HESABI =====

function getChangeInWindow(history: PriceTick[], windowMs: number): { change: number; changePct: number; speed: number } | null {
  if (history.length < 2) return null;
  const now = Date.now();
  const cutoff = now - windowMs;

  // En eski tick pencerede
  let oldest: PriceTick | null = null;
  for (const tick of history) {
    if (tick.time >= cutoff) { oldest = tick; break; }
  }
  if (!oldest) oldest = history[0]!;

  const latest = history[history.length - 1]!;
  const change = latest.price - oldest.price;
  const changePct = oldest.price > 0 ? (change / oldest.price) * 100 : 0;
  const timeDiff = (latest.time - oldest.time) / 1000; // saniye
  const speed = timeDiff > 0 ? changePct / timeDiff : 0; // %/saniye

  return { change, changePct, speed };
}

// BTC momentum
export function getBtcMomentum(windowSec: number = 30): { change: number; changePct: number; speed: number; direction: 'UP' | 'DOWN' | 'FLAT' } | null {
  const result = getChangeInWindow(BTC_HISTORY, windowSec * 1000);
  if (!result) return null;
  const direction = result.changePct > 0.05 ? 'UP' : result.changePct < -0.05 ? 'DOWN' : 'FLAT';
  return { ...result, direction };
}

// PM momentum (UP token fiyat değişimi)
export function getPmMomentum(windowSec: number = 30): { change: number; changePct: number; speed: number; direction: 'UP' | 'DOWN' | 'FLAT' } | null {
  const result = getChangeInWindow(PM_UP_HISTORY, windowSec * 1000);
  if (!result) return null;
  // PM fiyat artıyorsa market UP'a kayıyor
  const direction = result.change > 0.03 ? 'UP' : result.change < -0.03 ? 'DOWN' : 'FLAT';
  return { ...result, direction };
}

// ===== SPIKE TESPİTİ =====

export function detectSpike(windowSec: number = 10): { isSpike: boolean; direction: 'UP' | 'DOWN'; magnitude: number } {
  const btc = getBtcMomentum(windowSec);
  if (!btc) return { isSpike: false, direction: 'UP', magnitude: 0 };

  // Spike: %0.15+ hareket 10 saniyede (BTC $70K'da ~$105)
  const isSpike = Math.abs(btc.changePct) > 0.15;
  return {
    isSpike,
    direction: btc.changePct > 0 ? 'UP' : 'DOWN',
    magnitude: Math.abs(btc.changePct),
  };
}

// ===== ORACLE LAG TESPİTİ =====
// Binance fiyatı hareket etti ama PM henüz yansıtmadıysa → edge

export function detectOracleLag(): { hasLag: boolean; btcDirection: 'UP' | 'DOWN'; lagAmount: number; confidence: number } {
  const btc30 = getBtcMomentum(30);
  const pm30 = getPmMomentum(30);

  if (!btc30 || !pm30) return { hasLag: false, btcDirection: 'UP', lagAmount: 0, confidence: 0 };

  // BTC hareket etti ama PM aynı yönde yeterince hareket etmediyse
  const btcMoved = Math.abs(btc30.changePct) > 0.1; // BTC %0.1+ hareket
  const pmLagging = Math.abs(pm30.change) < 0.05; // PM 5c'den az değişti

  if (btcMoved && pmLagging) {
    return {
      hasLag: true,
      btcDirection: btc30.changePct > 0 ? 'UP' : 'DOWN',
      lagAmount: Math.abs(btc30.changePct),
      confidence: Math.min(100, Math.abs(btc30.changePct) * 200),
    };
  }

  return { hasLag: false, btcDirection: 'UP', lagAmount: 0, confidence: 0 };
}

// ===== DESTEK/DİRENÇ =====

export function getSupportResistance(klines: Array<{ high: number; low: number; close: number }>): { support: number; resistance: number; pivot: number } {
  if (klines.length < 10) return { support: 0, resistance: 0, pivot: 0 };

  const recent = klines.slice(-20);
  const highs = recent.map(k => k.high);
  const lows = recent.map(k => k.low);
  const lastClose = recent[recent.length - 1]!.close;
  const lastHigh = recent[recent.length - 1]!.high;
  const lastLow = recent[recent.length - 1]!.low;

  const pivot = (lastHigh + lastLow + lastClose) / 3;
  const support = 2 * pivot - lastHigh;
  const resistance = 2 * pivot - lastLow;

  return { support, resistance, pivot };
}

// ===== VOLUME SPIKE =====

export function detectVolumeSpike(klines: Array<{ volume: number }>): { isSpike: boolean; ratio: number } {
  if (klines.length < 10) return { isSpike: false, ratio: 1 };

  const recent = klines.slice(-10, -1); // son 10 mum (current hariç)
  const avgVol = recent.reduce((s, k) => s + k.volume, 0) / recent.length;
  const currentVol = klines[klines.length - 1]!.volume;
  const ratio = avgVol > 0 ? currentVol / avgVol : 1;

  return { isSpike: ratio > 2, ratio };
}

// ===== TÜM METRİKLER =====

export function getAllMetrics(klines: Array<{ high: number; low: number; close: number; volume: number }>) {
  return {
    btcMomentum10s: getBtcMomentum(10),
    btcMomentum30s: getBtcMomentum(30),
    btcMomentum60s: getBtcMomentum(60),
    pmMomentum30s: getPmMomentum(30),
    spike: detectSpike(10),
    oracleLag: detectOracleLag(),
    supportResistance: getSupportResistance(klines),
    volumeSpike: detectVolumeSpike(klines),
  };
}

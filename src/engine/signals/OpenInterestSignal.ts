import type { SignalResult, FuturesData } from '../../types/index.js';
import { clamp } from '../../utils/math.js';

export function calculateOpenInterestSignal(
  futuresData: FuturesData,
  priceNow: number,
  price5mAgo: number
): SignalResult {
  const { openInterest, openInterestPrev } = futuresData;

  if (openInterest === 0 || openInterestPrev === 0 || futuresData.lastUpdate === 0) {
    return { name: 'open_interest', score: 0, confidence: 0, timestamp: Date.now(), details: {} };
  }

  const oiChangePct = ((openInterest - openInterestPrev) / openInterestPrev) * 100;
  const priceChange = price5mAgo === 0 ? 0 : ((priceNow - price5mAgo) / price5mAgo) * 100;

  let signal = 0;

  // Lower thresholds for real-time detection (15s polling → tiny changes)
  const oiThresh = 0.005;

  // OI rising + price rising → new longs (bullish continuation)
  if (oiChangePct > oiThresh && priceChange > 0) signal = 40;
  // OI rising + price falling → new shorts (squeeze risk) → contrarian UP
  else if (oiChangePct > oiThresh && priceChange < 0) signal = 25;
  // OI falling + price rising → shorts closing (short squeeze)
  else if (oiChangePct < -oiThresh && priceChange > 0) signal = 30;
  // OI falling + price falling → longs closing (liquidation)
  else if (oiChangePct < -oiThresh && priceChange < 0) signal = -30;
  // Small OI change — proportional signal
  else if (Math.abs(oiChangePct) > 0.01) {
    signal = oiChangePct > 0 ? 10 : -10;
    if (priceChange > 0) signal += 5;
    if (priceChange < 0) signal -= 5;
  }

  const score = clamp(signal, -100, 100);

  return {
    name: 'open_interest',
    score,
    confidence: Math.abs(score),
    timestamp: Date.now(),
    details: {
      openInterest: Math.round(openInterest),
      oiChangePct: Math.round(oiChangePct * 1000) / 1000,
      priceChange: Math.round(priceChange * 1000) / 1000,
    },
  };
}

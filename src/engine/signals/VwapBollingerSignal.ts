import type { SignalResult } from '../../types/index.js';
import { clamp, VWAP, BollingerBands, SMA } from '../../utils/math.js';

const bandwidthHistory: number[] = [];

export function calculateVwapBollingerSignal(
  closes: number[],
  volumes: number[],
  currentPrice: number
): SignalResult {
  if (closes.length < 20 || volumes.length < 20) {
    return { name: 'vwap_bb', score: 0, confidence: 0, timestamp: Date.now(), details: {} };
  }

  // VWAP (last 30 candles for broader view)
  const vwapPrices = closes.slice(-30);
  const vwapVolumes = volumes.slice(-30);
  const vwap = VWAP(vwapPrices, vwapVolumes);
  const vwapDeviation = vwap === 0 ? 0 : ((currentPrice - vwap) / vwap) * 10000; // bps

  // Bollinger Bands (20, 2) on 1m candles
  const bb = BollingerBands(closes, 20, 2);

  // Bollinger squeeze detection
  bandwidthHistory.push(bb.bandwidth);
  if (bandwidthHistory.length > 50) bandwidthHistory.shift();
  const avgBandwidth = SMA(bandwidthHistory, 20);
  const isSqueeze = bb.bandwidth < avgBandwidth * 0.75;

  // Confluence signal
  let vwapSignal = 0;
  if (vwapDeviation < -15 && bb.position < 0.2) {
    vwapSignal = 70; // Below VWAP + lower BB = strong bounce signal (UP)
  } else if (vwapDeviation > 15 && bb.position > 0.8) {
    vwapSignal = -70; // Above VWAP + upper BB = pullback signal (DOWN)
  } else {
    vwapSignal = -vwapDeviation * 2; // Mean reversion bias
  }

  if (isSqueeze) vwapSignal *= 0.5; // Reduce in squeeze (direction uncertain)

  const score = clamp(vwapSignal, -100, 100);

  return {
    name: 'vwap_bb',
    score,
    confidence: Math.abs(score),
    timestamp: Date.now(),
    details: {
      vwap: Math.round(vwap * 100) / 100,
      vwapDeviation: Math.round(vwapDeviation * 100) / 100,
      bbUpper: Math.round(bb.upper * 100) / 100,
      bbLower: Math.round(bb.lower * 100) / 100,
      bbPosition: Math.round(bb.position * 1000) / 1000,
      bandwidth: Math.round(bb.bandwidth * 10000) / 10000,
      isSqueeze,
    },
  };
}

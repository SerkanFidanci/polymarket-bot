import type { SignalResult, FuturesData } from '../../types/index.js';
import { clamp } from '../../utils/math.js';

export function calculateFundingRateSignal(futuresData: FuturesData): SignalResult {
  const { fundingRate, fundingRatePrev } = futuresData;

  if (futuresData.lastUpdate === 0) {
    return { name: 'funding', score: 0, confidence: 0, timestamp: Date.now(), details: {} };
  }

  // Contrarian logic — more sensitive thresholds
  // Normal funding: 0.01% (0.0001). Anything above/below is signal.
  let signal = 0;
  if (fundingRate > 0.0002) signal = -60;          // Very positive → too many longs → DOWN
  else if (fundingRate > 0.00005) signal = -20;    // Slightly positive → mild DOWN bias
  else if (fundingRate > 0) signal = -5;            // Barely positive
  else if (fundingRate < -0.0002) signal = 60;     // Very negative → too many shorts → UP
  else if (fundingRate < -0.00005) signal = 20;    // Slightly negative → mild UP bias
  else if (fundingRate < 0) signal = 5;             // Barely negative

  // Rate change velocity
  const rateChange = fundingRate - fundingRatePrev;
  if (rateChange > 0.00005) signal -= 15;  // Rate rising → longs building
  if (rateChange < -0.00005) signal += 15; // Rate falling → shorts building

  const score = clamp(signal, -100, 100);

  return {
    name: 'funding',
    score,
    confidence: Math.abs(score),
    timestamp: Date.now(),
    details: {
      fundingRate: Math.round(fundingRate * 1000000) / 1000000,
      fundingRatePrev: Math.round(fundingRatePrev * 1000000) / 1000000,
      rateChange: Math.round(rateChange * 1000000) / 1000000,
      fundingRatePct: `${(fundingRate * 100).toFixed(4)}%`,
    },
  };
}

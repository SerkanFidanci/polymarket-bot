import type { SignalResult, FuturesData } from '../../types/index.js';
import { clamp } from '../../utils/math.js';

export function calculateLsRatioSignal(futuresData: FuturesData): SignalResult {
  const { globalLongShortRatio, topLongShortRatio, takerBuySellRatio } = futuresData;

  if (futuresData.lastUpdate === 0) {
    return { name: 'ls_ratio', score: 0, confidence: 0, timestamp: Date.now(), details: {} };
  }

  // Contrarian signal (crowd is usually wrong)
  let crowdSignal = 0;
  if (globalLongShortRatio > 2.0) crowdSignal = -50;       // Everyone long → contrarian DOWN
  else if (globalLongShortRatio > 1.5) crowdSignal = -20;
  else if (globalLongShortRatio < 0.5) crowdSignal = 50;   // Everyone short → contrarian UP
  else if (globalLongShortRatio < 0.7) crowdSignal = 20;

  // Smart money (top traders — follow them)
  let smartSignal = 0;
  if (topLongShortRatio > 1.5) smartSignal = 30;           // Top traders long → follow
  else if (topLongShortRatio < 0.7) smartSignal = -30;     // Top traders short → follow

  // Taker signal (aggressive buying/selling)
  let takerSignal = 0;
  if (takerBuySellRatio > 1.2) takerSignal = 40;           // Aggressive buyers dominant
  else if (takerBuySellRatio < 0.8) takerSignal = -40;     // Aggressive sellers dominant

  const score = clamp(
    crowdSignal * 0.3 + smartSignal * 0.3 + takerSignal * 0.4,
    -100,
    100
  );

  return {
    name: 'ls_ratio',
    score,
    confidence: Math.abs(score),
    timestamp: Date.now(),
    details: {
      globalLS: Math.round(globalLongShortRatio * 100) / 100,
      topLS: Math.round(topLongShortRatio * 100) / 100,
      takerRatio: Math.round(takerBuySellRatio * 100) / 100,
      crowdSignal,
      smartSignal,
      takerSignal,
    },
  };
}

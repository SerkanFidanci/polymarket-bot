import type { TradingMode } from '../types/index.js';
import type { SignalAccuracy } from '../types/signals.js';
import { logger } from '../utils/logger.js';

// ===== PHASE TRANSITION CONDITIONS =====

interface PhaseCheck {
  label: string;
  met: boolean;
}

export interface PhaseStatus {
  currentMode: TradingMode;
  canAdvance: boolean;
  checks: PhaseCheck[];
  nextMode: TradingMode | null;
}

export function checkPassiveToPaper(
  trainingRoundsCount: number,
  signalAccuracies: SignalAccuracy[],
  firstOptimizationDone: boolean
): PhaseStatus {
  const checks: PhaseCheck[] = [
    {
      label: `Min 500 training rounds (${trainingRoundsCount}/500)`,
      met: trainingRoundsCount >= 500,
    },
    {
      label: 'All 10 signals have min 100 predictions',
      met: signalAccuracies.every(a => a.totalPredictions >= 100),
    },
    {
      label: 'First weight optimization completed',
      met: firstOptimizationDone,
    },
  ];

  return {
    currentMode: 'passive',
    canAdvance: checks.every(c => c.met),
    checks,
    nextMode: 'paper',
  };
}

export function checkPaperToLive(
  paperTradesCount: number,
  winRate: number,
  totalPnl: number,
  maxDrawdown: number,
  signalAccuracies: SignalAccuracy[]
): PhaseStatus {
  const checks: PhaseCheck[] = [
    {
      label: `Min 200 paper trades (${paperTradesCount}/200)`,
      met: paperTradesCount >= 200,
    },
    {
      label: `Win rate > 55% (${(winRate * 100).toFixed(1)}%)`,
      met: winRate > 0.55,
    },
    {
      label: `Net P&L positive ($${totalPnl.toFixed(2)})`,
      met: totalPnl > 0,
    },
    {
      label: `Max drawdown < 30% (${(maxDrawdown * 100).toFixed(1)}%)`,
      met: maxDrawdown < 0.30,
    },
    {
      label: 'All signals > 50% accuracy',
      met: signalAccuracies.filter(a => a.status !== 'DISABLED').every(a => a.accuracy >= 0.50),
    },
  ];

  return {
    currentMode: 'paper',
    canAdvance: checks.every(c => c.met),
    checks,
    nextMode: 'live',
  };
}

export function transitionPhase(from: TradingMode, to: TradingMode): boolean {
  if (from === 'passive' && to === 'paper') {
    logger.info('Phase', 'TRANSITIONING: PASSIVE → PAPER');
    return true;
  }
  if (from === 'paper' && to === 'live') {
    logger.info('Phase', 'TRANSITIONING: PAPER → LIVE (user confirmed)');
    return true;
  }
  logger.warn('Phase', `Invalid transition: ${from} → ${to}`);
  return false;
}

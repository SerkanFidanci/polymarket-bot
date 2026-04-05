import { signalEngine } from './SignalEngine.js';
import { runOptimizationCycle, measureAllSignalAccuracy } from './OptimizationEngine.js';
import { checkPassiveToPaper, checkPaperToLive, type PhaseStatus } from './PhaseController.js';
import { logger } from '../utils/logger.js';
import type { SignalWeights, SignalAccuracy } from '../types/signals.js';
import type { TradingMode } from '../types/index.js';

interface TrainingState {
  roundsSinceLastAccuracyCheck: number;
  roundsSinceLastOptimize: number;
  firstOptimizationDone: boolean;
  lastAccuracies: SignalAccuracy[];
  proposedWeights: SignalWeights | null;
  phaseStatus: PhaseStatus | null;
}

const state: TrainingState = {
  roundsSinceLastAccuracyCheck: 0,
  roundsSinceLastOptimize: 0,
  firstOptimizationDone: false,
  lastAccuracies: [],
  proposedWeights: null,
  phaseStatus: null,
};

type TrainingCallbacks = {
  onAccuracyUpdate: (accuracies: SignalAccuracy[]) => void;
  onWeightsProposed: (current: SignalWeights, proposed: SignalWeights) => void;
  onPhaseStatusUpdate: (status: PhaseStatus) => void;
  onOptimizationComplete: (applied: boolean, reason: string) => void;
};

let callbacks: TrainingCallbacks | null = null;

async function fetchTrainingRounds(): Promise<unknown[]> {
  try {
    const res = await fetch('/api/training-rounds/all');
    if (!res.ok) return [];
    return await res.json() as unknown[];
  } catch {
    return [];
  }
}

async function logAccuracyToDB(accuracies: SignalAccuracy[], weights: SignalWeights) {
  try {
    await fetch('/api/signal-accuracy-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(accuracies.map(a => ({
        signalName: a.signalName,
        periodRounds: a.totalPredictions + Math.round(a.abstainRate * a.totalPredictions / (1 - a.abstainRate || 1)),
        accuracy: a.accuracy,
        edgeOverRandom: a.edgeOverRandom,
        abstainRate: a.abstainRate,
        currentWeight: weights[a.signalName],
        status: a.status,
      }))),
    });
  } catch { /* silent */ }
}

async function logOptimizationToDB(
  type: string, roundsAnalyzed: number,
  oldWeights: SignalWeights, newWeights: SignalWeights,
  oldPnl: number, newPnl: number,
  improvement: number, applied: boolean, reason: string
) {
  try {
    await fetch('/api/optimization-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type, roundsAnalyzed,
        oldWeights: JSON.stringify(oldWeights),
        newWeights: JSON.stringify(newWeights),
        oldPnl, newPnl, improvement, applied, reason,
      }),
    });
  } catch { /* silent */ }
}

export const trainingManager = {
  getState() {
    return { ...state };
  },

  setCallbacks(cb: TrainingCallbacks) {
    callbacks = cb;
  },

  // Called after each round is recorded
  async onRoundRecorded(totalRounds: number, mode: TradingMode) {
    state.roundsSinceLastAccuracyCheck++;
    state.roundsSinceLastOptimize++;

    // Every 100 rounds: measure accuracy
    if (state.roundsSinceLastAccuracyCheck >= 100) {
      state.roundsSinceLastAccuracyCheck = 0;
      await this.runAccuracyCheck(totalRounds, mode);
    }

    // Every 500 rounds: full optimization
    if (state.roundsSinceLastOptimize >= 500) {
      await this.runFullOptimization();
      state.roundsSinceLastOptimize = 0;
    }

    // Check phase transitions
    this.checkPhaseTransition(totalRounds, mode);
  },

  async runAccuracyCheck(_totalRounds: number, _mode: TradingMode) {
    const rounds = await fetchTrainingRounds();
    if (rounds.length < 20) return;

    const currentWeights = signalEngine.getWeights();
    const accuracies = measureAllSignalAccuracy(rounds as Parameters<typeof measureAllSignalAccuracy>[0]);
    state.lastAccuracies = accuracies;

    await logAccuracyToDB(accuracies, currentWeights);

    logger.info('Training', `Accuracy check (${rounds.length} rounds): ${accuracies.map(a => `${a.signalName}:${(a.accuracy * 100).toFixed(1)}%`).join(', ')}`);

    callbacks?.onAccuracyUpdate(accuracies);
  },

  async runFullOptimization() {
    const rounds = await fetchTrainingRounds();
    if (rounds.length < 100) return;

    const currentWeights = signalEngine.getWeights();

    const result = await runOptimizationCycle(
      rounds as Parameters<typeof runOptimizationCycle>[0],
      currentWeights,
      state.roundsSinceLastOptimize
    );

    state.lastAccuracies = result.accuracies;

    if (result.proposedWeights && result.applied) {
      state.proposedWeights = result.proposedWeights;
      state.firstOptimizationDone = true;

      // Apply to signal engine
      signalEngine.setWeights(result.proposedWeights);

      await logOptimizationToDB(
        'weights', rounds.length,
        currentWeights, result.proposedWeights,
        0, result.proposedWeights ? 1 : 0,
        0, true, result.reason
      );

      callbacks?.onWeightsProposed(currentWeights, result.proposedWeights);
      callbacks?.onOptimizationComplete(true, result.reason);

      logger.trade('Training', `Weights updated: ${result.reason}`);
    } else {
      callbacks?.onOptimizationComplete(false, result.reason);
      logger.info('Training', `Optimization: ${result.reason}`);
    }

    callbacks?.onAccuracyUpdate(result.accuracies);
  },

  checkPhaseTransition(totalRounds: number, mode: TradingMode) {
    if (mode === 'passive') {
      const status = checkPassiveToPaper(
        totalRounds,
        state.lastAccuracies,
        state.firstOptimizationDone
      );
      state.phaseStatus = status;
      callbacks?.onPhaseStatusUpdate(status);
    } else if (mode === 'paper') {
      // These would come from bankroll manager
      // For now use placeholder values
      const status = checkPaperToLive(0, 0, 0, 0, state.lastAccuracies);
      state.phaseStatus = status;
      callbacks?.onPhaseStatusUpdate(status);
    }
  },

  getProposedWeights(): SignalWeights | null {
    return state.proposedWeights;
  },

  getLastAccuracies(): SignalAccuracy[] {
    return [...state.lastAccuracies];
  },

  getPhaseStatus(): PhaseStatus | null {
    return state.phaseStatus;
  },
};

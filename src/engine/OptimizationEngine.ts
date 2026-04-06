import type { SignalName, SignalWeights, SignalAccuracy } from '../types/signals.js';
import { DEFAULT_WEIGHTS } from '../types/signals.js';
import { clamp } from '../utils/math.js';
import { logger } from '../utils/logger.js';

// ===== TYPES =====

interface TrainingRow {
  actual_result: string;
  signal_orderbook: number;
  signal_ema_macd: number;
  signal_rsi_stoch: number;
  signal_vwap_bb: number;
  signal_cvd: number;
  signal_whale: number;
  signal_funding: number;
  signal_open_interest: number;
  signal_liquidation: number;
  signal_ls_ratio: number;
  final_score: number;
  confidence: number;
  polymarket_up_price: number | null;
}

interface ThresholdConfig {
  minConfidence: number;
  minSignalStrength: number;
  kellyFraction: number;
  maxBetPercent: number;
}

interface OptimizationResult {
  weights: SignalWeights;
  thresholds?: ThresholdConfig;
  simulatedPnl: number;
  sharpe: number;
  roundsAnalyzed: number;
}

const SIGNAL_COLUMNS: Record<SignalName, string> = {
  orderbook: 'signal_orderbook',
  ema_macd: 'signal_ema_macd',
  rsi_stoch: 'signal_rsi_stoch',
  vwap_bb: 'signal_vwap_bb',
  cvd: 'signal_cvd',
  whale: 'signal_whale',
  funding: 'signal_funding',
  open_interest: 'signal_open_interest',
  liquidation: 'signal_liquidation',
  ls_ratio: 'signal_ls_ratio',
};

const ALL_SIGNALS: SignalName[] = Object.keys(SIGNAL_COLUMNS) as SignalName[];

// ===== SIGNAL ACCURACY =====

export function measureSignalAccuracy(signalName: SignalName, rounds: TrainingRow[]): SignalAccuracy {
  let correct = 0;
  let incorrect = 0;
  let abstain = 0;

  const col = SIGNAL_COLUMNS[signalName];

  for (const round of rounds) {
    const score = (round as unknown as Record<string, number>)[col] ?? 0;
    const actualResult = round.actual_result;

    if (Math.abs(score) < 10) {
      abstain++;
      continue;
    }

    const signalDirection = score > 0 ? 'UP' : 'DOWN';
    if (signalDirection === actualResult) {
      correct++;
    } else {
      incorrect++;
    }
  }

  const total = correct + incorrect;
  const accuracy = total > 0 ? correct / total : 0.5;
  const edgeOverRandom = accuracy - 0.5;

  // Determine status
  let status: 'ACTIVE' | 'WARNING' | 'DISABLED' = 'ACTIVE';
  if (rounds.length >= 500 && accuracy < 0.48) status = 'WARNING';
  if (rounds.length >= 1000 && accuracy < 0.48) status = 'WARNING';
  if (rounds.length >= 2000 && accuracy < 0.45) status = 'DISABLED';

  return {
    signalName,
    accuracy,
    totalPredictions: total,
    correct,
    incorrect,
    abstainRate: rounds.length > 0 ? abstain / rounds.length : 0,
    edgeOverRandom,
    status,
  };
}

export function measureAllSignalAccuracy(rounds: TrainingRow[]): SignalAccuracy[] {
  return ALL_SIGNALS.map(name => measureSignalAccuracy(name, rounds));
}

// ===== WEIGHT OPTIMIZATION — Method 1: Edge-based =====

export function optimizeWeightsByEdge(rounds: TrainingRow[]): SignalWeights {
  const accuracies = measureAllSignalAccuracy(rounds);
  const edges: Record<string, number> = {};
  let totalEdge = 0;

  for (const acc of accuracies) {
    const edge = Math.max(0, acc.edgeOverRandom);
    edges[acc.signalName] = edge;
    totalEdge += edge;
  }

  const newWeights = { ...DEFAULT_WEIGHTS };
  for (const name of ALL_SIGNALS) {
    if (totalEdge === 0) {
      newWeights[name] = 1 / ALL_SIGNALS.length;
    } else {
      newWeights[name] = clamp(edges[name]! / totalEdge, 0.05, 0.50);
    }
  }

  // Normalize to sum = 1.0
  const sum = Object.values(newWeights).reduce((a, b) => a + b, 0);
  for (const name of ALL_SIGNALS) {
    newWeights[name] = newWeights[name] / sum;
  }

  return newWeights;
}

// ===== WEIGHT OPTIMIZATION — Method 2: Grid Search =====

function getSignalScore(round: TrainingRow, name: SignalName): number {
  return (round as unknown as Record<string, number>)[SIGNAL_COLUMNS[name]] ?? 0;
}

function simulateWithWeights(
  rounds: TrainingRow[],
  weights: SignalWeights,
  config: ThresholdConfig = { minConfidence: 30, minSignalStrength: 15, kellyFraction: 0.5, maxBetPercent: 0.15 }
): { pnl: number; sharpe: number; wins: number; losses: number; skips: number } {
  let bankroll = 50;
  let totalPnl = 0;
  const dailyPnls: number[] = [];
  let dayPnl = 0;
  let wins = 0;
  let losses = 0;
  let skips = 0;

  for (let i = 0; i < rounds.length; i++) {
    const round = rounds[i]!;

    // Calculate score with given weights
    let score = 0;
    for (const name of ALL_SIGNALS) {
      score += getSignalScore(round, name) * weights[name];
    }

    // Calculate confidence (simplified)
    const activeSigns = ALL_SIGNALS
      .filter(n => Math.abs(getSignalScore(round, n)) > 10)
      .map(n => Math.sign(getSignalScore(round, n)));

    let confidence = 0;
    if (activeSigns.length > 0) {
      const majority = Math.max(
        activeSigns.filter(s => s === 1).length,
        activeSigns.filter(s => s === -1).length
      );
      confidence = Math.abs(score) * (majority / activeSigns.length);
    }

    // Decision
    if (confidence < config.minConfidence || Math.abs(score) < config.minSignalStrength) {
      skips++;
      continue;
    }

    const direction = score > 0 ? 'UP' : 'DOWN';
    const price = round.polymarket_up_price ?? 0.50;
    const ourProb = clamp(0.5 + (Math.abs(score) / 200), 0.51, 0.85);

    const winAmount = 1 - price;
    const loseAmount = price;
    const ev = (ourProb * winAmount) - ((1 - ourProb) * loseAmount);
    if (ev <= 0) { skips++; continue; }

    const b = winAmount / loseAmount;
    const kelly = ((b * ourProb) - (1 - ourProb)) / b;
    const halfKelly = kelly * config.kellyFraction;
    let betSize = clamp(bankroll * halfKelly, 1, bankroll * config.maxBetPercent);

    if (betSize > bankroll || betSize < 1) { skips++; continue; }

    const won = direction === round.actual_result;
    const pnl = won ? betSize * (winAmount / loseAmount) : -betSize;

    bankroll += pnl;
    totalPnl += pnl;
    dayPnl += pnl;

    if (won) wins++; else losses++;

    // Daily boundary (every ~288 rounds ≈ 1 day)
    if (i % 288 === 287) {
      dailyPnls.push(dayPnl);
      dayPnl = 0;
    }

    if (bankroll <= 0) break;
  }
  if (dayPnl !== 0) dailyPnls.push(dayPnl);

  // Sharpe ratio
  let sharpe = 0;
  if (dailyPnls.length >= 2) {
    const mean = dailyPnls.reduce((a, b) => a + b, 0) / dailyPnls.length;
    const variance = dailyPnls.reduce((s, r) => s + (r - mean) ** 2, 0) / dailyPnls.length;
    const std = Math.sqrt(variance);
    sharpe = std === 0 ? 0 : mean / std;
  }

  return { pnl: totalPnl, sharpe, wins, losses, skips };
}

export function gridSearchWeights(rounds: TrainingRow[]): OptimizationResult {
  const step = 0.05;
  let bestWeights: SignalWeights = { ...DEFAULT_WEIGHTS };
  let bestPnl = -Infinity;
  let bestSharpe = 0;

  // For 10 signals, full grid search is infeasible (10^10 combinations)
  // Use a two-phase approach:
  // Phase 1: Optimize edge-based weights
  // Phase 2: Perturb each weight ±0.05 and test

  // Phase 1: Start from edge-based
  const edgeWeights = optimizeWeightsByEdge(rounds);
  const baseResult = simulateWithWeights(rounds, edgeWeights);
  bestWeights = { ...edgeWeights };
  bestPnl = baseResult.pnl;
  bestSharpe = baseResult.sharpe;

  // Phase 2: Hill-climbing perturbation (100 iterations)
  let currentWeights = { ...edgeWeights };
  for (let iter = 0; iter < 100; iter++) {
    // Pick a random signal to adjust
    const idx = Math.floor(Math.random() * ALL_SIGNALS.length);
    const signal = ALL_SIGNALS[idx]!;
    const other = ALL_SIGNALS[(idx + 1 + Math.floor(Math.random() * (ALL_SIGNALS.length - 1))) % ALL_SIGNALS.length]!;

    const testWeights = { ...currentWeights };
    const delta = (Math.random() > 0.5 ? 1 : -1) * step;
    testWeights[signal] = clamp(testWeights[signal] + delta, 0.05, 0.50);
    testWeights[other] = clamp(testWeights[other] - delta, 0.05, 0.50);

    // Normalize
    const sum = Object.values(testWeights).reduce((a, b) => a + b, 0);
    for (const name of ALL_SIGNALS) testWeights[name] /= sum;

    const result = simulateWithWeights(rounds, testWeights);
    if (result.pnl > bestPnl) {
      bestPnl = result.pnl;
      bestSharpe = result.sharpe;
      bestWeights = { ...testWeights };
      currentWeights = { ...testWeights };
    }
  }

  return {
    weights: bestWeights,
    simulatedPnl: bestPnl,
    sharpe: bestSharpe,
    roundsAnalyzed: rounds.length,
  };
}

// ===== THRESHOLD OPTIMIZATION =====

export function optimizeThresholds(rounds: TrainingRow[], weights: SignalWeights): ThresholdConfig {
  let bestConfig: ThresholdConfig = { minConfidence: 30, minSignalStrength: 15, kellyFraction: 0.5, maxBetPercent: 0.15 };
  let bestSharpe = -Infinity;

  for (let conf = 20; conf <= 60; conf += 10) {
    for (let sig = 10; sig <= 40; sig += 10) {
      for (let kelly = 0.25; kelly <= 0.75; kelly += 0.25) {
        for (let maxBet = 0.05; maxBet <= 0.25; maxBet += 0.10) {
          const config: ThresholdConfig = { minConfidence: conf, minSignalStrength: sig, kellyFraction: kelly, maxBetPercent: maxBet };
          const result = simulateWithWeights(rounds, weights, config);
          if (result.sharpe > bestSharpe) {
            bestSharpe = result.sharpe;
            bestConfig = config;
          }
        }
      }
    }
  }

  return bestConfig;
}

// ===== GRADUAL WEIGHT UPDATE =====

export function applyGradualUpdate(current: SignalWeights, proposed: SignalWeights, maxDelta: number = 0.05): SignalWeights {
  const result = { ...current };
  for (const name of ALL_SIGNALS) {
    const diff = proposed[name] - current[name];
    const clamped = clamp(diff, -maxDelta, maxDelta);
    result[name] = clamp(current[name] + clamped, 0, 1);
  }

  // Normalize
  const sum = Object.values(result).reduce((a, b) => a + b, 0);
  if (sum > 0) {
    for (const name of ALL_SIGNALS) result[name] /= sum;
  }

  return result;
}

// ===== SIGNAL RETIREMENT =====

export function evaluateSignalRetirement(
  accuracies: SignalAccuracy[],
  currentWeights: SignalWeights,
  totalRounds: number = 0
): { weights: SignalWeights; changes: string[] } {
  const weights = { ...currentWeights };
  const changes: string[] = [];

  // --- Per-signal status checks ---
  for (const acc of accuracies) {
    const name = acc.signalName;

    if (acc.status === 'DISABLED') {
      if (weights[name] !== 0) {
        weights[name] = 0;
        changes.push(`${name}: DISABLED (accuracy ${(acc.accuracy * 100).toFixed(1)}% over ${acc.totalPredictions} predictions)`);
      }
      // Check for reactivation: 500+ predictions and accuracy > 55%
      if (acc.totalPredictions >= 500 && acc.accuracy > 0.55) {
        weights[name] = 0.05;
        changes.push(`${name}: REACTIVATED (accuracy ${(acc.accuracy * 100).toFixed(1)}%)`);
      }
    } else if (acc.status === 'WARNING') {
      if (weights[name] > 0.05) {
        weights[name] = 0.05;
        changes.push(`${name}: WARNING → weight minimized (accuracy ${(acc.accuracy * 100).toFixed(1)}%)`);
      }
    }
  }

  // --- Every 1000 rounds: auto-disable worst 2 signals with accuracy < 48% ---
  if (totalRounds > 0 && totalRounds % 1000 === 0) {
    const activeAccuracies = accuracies
      .filter(a => weights[a.signalName] > 0 && a.totalPredictions >= 50)
      .sort((a, b) => a.accuracy - b.accuracy);

    let disabled = 0;
    for (const acc of activeAccuracies) {
      if (disabled >= 2) break;
      if (acc.accuracy < 0.48) {
        weights[acc.signalName] = 0;
        disabled++;
        changes.push(`${acc.signalName}: AUTO-RETIRED at round ${totalRounds} (accuracy ${(acc.accuracy * 100).toFixed(1)}%, worst performer)`);
      }
    }
  }

  // Normalize remaining
  if (changes.length > 0) {
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    if (sum > 0) {
      for (const name of ALL_SIGNALS) {
        if (weights[name] > 0) weights[name] /= sum;
      }
    }
  }

  return { weights, changes };
}

// ===== CONTINUOUS LEARNING RUNNER =====

export async function runOptimizationCycle(
  rounds: TrainingRow[],
  currentWeights: SignalWeights,
  roundsSinceLastOptimize: number
): Promise<{
  accuracies: SignalAccuracy[];
  proposedWeights: SignalWeights | null;
  thresholds: ThresholdConfig | null;
  applied: boolean;
  reason: string;
}> {
  // Always measure accuracy
  const accuracies = measureAllSignalAccuracy(rounds);

  // Check signal retirement
  const retirement = evaluateSignalRetirement(accuracies, currentWeights, rounds.length);
  if (retirement.changes.length > 0) {
    for (const change of retirement.changes) {
      logger.warn('Optimization', change);
    }
  }

  // Not enough data yet
  if (rounds.length < 100) {
    return {
      accuracies,
      proposedWeights: retirement.changes.length > 0 ? retirement.weights : null,
      thresholds: null,
      applied: retirement.changes.length > 0,
      reason: retirement.changes.length > 0 ? 'Signal retirement applied' : 'Not enough rounds for optimization',
    };
  }

  // Edge-based optimization at 200+ rounds
  if (roundsSinceLastOptimize >= 200 && roundsSinceLastOptimize < 500) {
    logger.info('Optimization', `Running edge-based optimization on ${rounds.length} rounds...`);
    const edgeWeights = optimizeWeightsByEdge(rounds);
    const gradualWeights = applyGradualUpdate(currentWeights, edgeWeights);

    const currentResult = simulateWithWeights(rounds, currentWeights);
    const newResult = simulateWithWeights(rounds, gradualWeights);

    if (newResult.pnl >= currentResult.pnl) {
      return {
        accuracies,
        proposedWeights: gradualWeights,
        thresholds: null,
        applied: true,
        reason: `Edge-based optimization (${rounds.length} rounds)`,
      };
    }

    return {
      accuracies,
      proposedWeights: null,
      thresholds: null,
      applied: false,
      reason: `Edge-based: no improvement (current: $${currentResult.pnl.toFixed(2)}, proposed: $${newResult.pnl.toFixed(2)})`,
    };
  }

  // Full grid search at 500+ rounds
  if (roundsSinceLastOptimize < 500) {
    return {
      accuracies,
      proposedWeights: retirement.changes.length > 0 ? retirement.weights : null,
      thresholds: null,
      applied: retirement.changes.length > 0,
      reason: retirement.changes.length > 0 ? 'Signal retirement applied' : 'Waiting for 500 rounds for full optimization',
    };
  }

  logger.info('Optimization', `Running grid search on ${rounds.length} rounds...`);
  const optimResult = gridSearchWeights(rounds);

  // Compare with current weights
  const currentResult = simulateWithWeights(rounds, currentWeights);
  const improvement = currentResult.pnl === 0
    ? (optimResult.simulatedPnl > 0 ? 100 : 0)
    : ((optimResult.simulatedPnl - currentResult.pnl) / Math.abs(currentResult.pnl)) * 100;

  if (optimResult.simulatedPnl > currentResult.pnl) {
    const gradualWeights = applyGradualUpdate(currentWeights, optimResult.weights);
    const thresholds = optimizeThresholds(rounds, gradualWeights);

    logger.info('Optimization', `New weights improve P&L by ${improvement.toFixed(1)}% ($${currentResult.pnl.toFixed(2)} → $${optimResult.simulatedPnl.toFixed(2)})`);

    return {
      accuracies,
      proposedWeights: gradualWeights,
      thresholds,
      applied: true,
      reason: `Improvement: +${improvement.toFixed(1)}%`,
    };
  }

  return {
    accuracies,
    proposedWeights: null,
    thresholds: null,
    applied: false,
    reason: `No improvement (current: $${currentResult.pnl.toFixed(2)}, proposed: $${optimResult.simulatedPnl.toFixed(2)})`,
  };
}

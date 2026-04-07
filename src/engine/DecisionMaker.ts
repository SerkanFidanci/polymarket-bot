import type { Decision, DecisionAction, Direction, CombinedSignal, BankrollState, RiskConfig } from '../types/index.js';
import { clamp } from '../utils/math.js';
import { isWeekendLowLiquidity } from '../utils/time.js';
import { logger } from '../utils/logger.js';

interface DecisionContext {
  signal: CombinedSignal;
  bankroll: BankrollState;
  config: RiskConfig;
  priceUp: number;
  priceDown: number;
  hasOpenPosition: boolean;
  dataAge: number;
  roundTimeRemaining: number;
  highVolatility: boolean;
  lowLiquidity: boolean;
  feeRate?: number;   // Polymarket taker fee
  spread?: number;    // Order book spread
}

export function makeDecision(ctx: DecisionContext): Decision {
  const { signal, bankroll, config, priceUp, priceDown, hasOpenPosition, dataAge, roundTimeRemaining, highVolatility, lowLiquidity, feeRate, spread } = ctx;
  const now = Date.now();

  // ===== HARD SKIP CONDITIONS =====

  if (hasOpenPosition) {
    return skip('Open position exists — wait for result', now);
  }

  if (dataAge > config.staleDataThreshold) {
    return skip(`Stale data (${dataAge}ms old)`, now);
  }

  if (roundTimeRemaining < 30) {
    return skip(`Too late to enter (${roundTimeRemaining}s left)`, now);
  }

  if (roundTimeRemaining > 270) {
    return skip(`Too early (${roundTimeRemaining}s left, waiting for 30-90s window)`, now);
  }

  if (bankroll.balance < config.minBet) {
    return stop('Bankroll below minimum bet', now);
  }

  if (bankroll.dailyPnl < -(bankroll.dailyStartBalance * config.dailyLossLimit)) {
    return stop(`Daily loss limit hit ($${bankroll.dailyPnl.toFixed(2)})`, now);
  }

  if (bankroll.consecutiveLosses >= config.tiltLevel3) {
    return stop(`Tilt level 3: ${bankroll.consecutiveLosses} consecutive losses`, now);
  }

  // Extreme odds filter
  if (priceUp < config.extremeOddsMin || priceUp > config.extremeOddsMax) {
    return skip(`Extreme odds (Up: ${priceUp.toFixed(2)})`, now);
  }

  // Price validity guard
  if (!priceUp || !priceDown || (priceUp + priceDown) < 0.9) {
    return skip('No valid price snapshot', now);
  }

  // Fee filter
  const fee = feeRate ?? 0.02;
  if (fee > config.maxFeeRate) {
    return skip(`Fee too high (${(fee * 100).toFixed(1)}% > ${(config.maxFeeRate * 100).toFixed(0)}%)`, now);
  }

  // Spread filter
  if (spread !== undefined && spread > config.maxSpread) {
    return skip(`Spread too wide (${(spread * 100).toFixed(1)}¢ > ${(config.maxSpread * 100).toFixed(0)}¢)`, now);
  }

  // ===== DYNAMIC THRESHOLDS =====

  let minConfidence = 20;
  let minScore = 15;

  if (highVolatility) {
    minConfidence = 45;
    minScore = 25;
  }

  if (lowLiquidity || isWeekendLowLiquidity()) {
    minConfidence = Math.max(minConfidence, 30);
    minScore = Math.max(minScore, 20);
  }

  // Tilt adjustments
  if (bankroll.consecutiveLosses >= config.tiltLevel1) {
    minConfidence += 10;
    minScore += 5;
  }
  if (bankroll.consecutiveLosses >= config.tiltLevel2) {
    minConfidence += 20;
    minScore += 10;
  }

  // Early entry requires higher confidence
  if (roundTimeRemaining > 210) {
    minConfidence += 15;
  }

  // Overconfidence cap: data shows C>50 = 30% WR (overfit)
  if (signal.confidence > 50) {
    return skip(`Overconfidence cap (${signal.confidence.toFixed(0)} > 50)`, now);
  }

  // Check thresholds
  if (signal.confidence < minConfidence) {
    return skip(`Low confidence (${signal.confidence.toFixed(0)} < ${minConfidence})`, now);
  }

  if (Math.abs(signal.finalScore) < minScore) {
    return skip(`Weak signal (|${signal.finalScore.toFixed(1)}| < ${minScore})`, now);
  }

  // ===== DIRECTION + PROBABILITY =====

  const direction: Direction = signal.finalScore > 0 ? 'UP' : 'DOWN';

  // BUY_UP bias fix: UP trades WR=38% vs DOWN WR=56%
  // Require stronger score for UP direction
  const dirMinScore = direction === 'UP' ? 20 : minScore;
  if (Math.abs(signal.finalScore) < dirMinScore) {
    return skip(`Weak ${direction} signal (|${signal.finalScore.toFixed(1)}| < ${dirMinScore})`, now);
  }

  const price = direction === 'UP' ? priceUp : priceDown;
  const ourProbability = clamp(0.5 + (Math.abs(signal.finalScore) / 200), 0.51, 0.85);

  // ===== EV CALCULATION (with fee) =====

  const winAmount = (1 - price) * 1;
  const loseAmount = price * 1;
  const ev = (ourProbability * winAmount) - ((1 - ourProbability) * loseAmount) - fee;

  if (ev <= 0) {
    return skip(`Negative EV after fee (${ev.toFixed(4)}, fee: ${(fee * 100).toFixed(1)}%)`, now);
  }

  // ===== ZONE-BASED KELLY =====

  // Determine Kelly fraction based on price zone
  let kellyBase: number;
  if (price <= 0.25 || price >= 0.75) {
    // Extreme zone — market is very confident, lower fee, lower risk
    kellyBase = config.kellyFractionAggressive;
  } else if (price >= 0.40 && price <= 0.60) {
    // Uncertain zone — coin flip, higher fee, higher risk
    kellyBase = config.kellyFractionConservative;
  } else {
    // Normal zone
    kellyBase = config.kellyFraction;
  }

  const b = winAmount / loseAmount;
  const kelly = ((b * ourProbability) - (1 - ourProbability)) / b;
  let adjustedKelly = kelly * kellyBase;

  // Risk adjustments
  if (bankroll.consecutiveLosses >= config.tiltLevel1) {
    adjustedKelly *= 0.5;
  }
  if (bankroll.consecutiveLosses >= config.tiltLevel2) {
    adjustedKelly *= 0.25;
  }

  if (bankroll.consecutiveLosses >= config.tiltLevel1 && bankroll.consecutiveLosses < config.tiltLevel2) {
    adjustedKelly *= 0.5;
  }

  if (highVolatility) {
    adjustedKelly *= 0.5;
  }

  if (isWeekendLowLiquidity()) {
    adjustedKelly *= 0.5;
  }

  if (bankroll.dailyPnl > bankroll.dailyStartBalance * config.dailyProfitTarget) {
    adjustedKelly *= 0.5;
  }

  // Calculate bet size
  let betSize = bankroll.balance * adjustedKelly;
  betSize = clamp(betSize, config.minBet, bankroll.balance * config.maxBetPercent);

  if (betSize > bankroll.balance) {
    betSize = bankroll.balance * 0.8;
  }

  if (betSize < config.minBet) {
    return skip(`Bet too small ($${betSize.toFixed(2)} < $${config.minBet})`, now);
  }

  const contracts = Math.floor(betSize / price);
  if (contracts < 1) {
    return skip('Cannot afford even 1 contract', now);
  }

  const action: DecisionAction = direction === 'UP' ? 'BUY_UP' : 'BUY_DOWN';

  logger.trade('Decision', `${action} $${betSize.toFixed(2)} @ ${price.toFixed(4)} | EV: ${ev.toFixed(4)} (fee:${(fee*100).toFixed(1)}%) | Kelly: ${(adjustedKelly * 100).toFixed(1)}% (zone:${kellyBase}) | Conf: ${signal.confidence.toFixed(0)}`);

  return {
    action,
    direction,
    betSize: Math.round(betSize * 100) / 100,
    ev: Math.round(ev * 10000) / 10000,
    confidence: Math.round(signal.confidence * 100) / 100,
    score: Math.round(signal.finalScore * 100) / 100,
    ourProbability: Math.round(ourProbability * 10000) / 10000,
    kellyFraction: Math.round(adjustedKelly * 10000) / 10000,
    reason: `${action} — EV:${ev.toFixed(3)}, Conf:${signal.confidence.toFixed(0)}, Score:${signal.finalScore.toFixed(1)}, Fee:${(fee*100).toFixed(1)}%`,
    timestamp: now,
  };
}

function skip(reason: string, timestamp: number): Decision {
  return { action: 'SKIP', reason, timestamp };
}

function stop(reason: string, timestamp: number): Decision {
  logger.warn('Decision', `STOP: ${reason}`);
  return { action: 'STOP', reason, timestamp };
}

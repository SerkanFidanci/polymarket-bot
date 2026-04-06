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
  dataAge: number; // ms since last data
  roundTimeRemaining: number; // seconds left in round
  highVolatility: boolean;
  lowLiquidity: boolean;
}

export function makeDecision(ctx: DecisionContext): Decision {
  const { signal, bankroll, config, priceUp, priceDown, hasOpenPosition, dataAge, roundTimeRemaining, highVolatility, lowLiquidity } = ctx;
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

  // ===== DYNAMIC THRESHOLDS =====

  let minConfidence = 30;
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

  // Check thresholds
  if (signal.confidence < minConfidence) {
    return skip(`Low confidence (${signal.confidence.toFixed(0)} < ${minConfidence})`, now);
  }

  if (Math.abs(signal.finalScore) < minScore) {
    return skip(`Weak signal (|${signal.finalScore.toFixed(1)}| < ${minScore})`, now);
  }

  // ===== DIRECTION + PROBABILITY =====

  const direction: Direction = signal.finalScore > 0 ? 'UP' : 'DOWN';
  const price = direction === 'UP' ? priceUp : priceDown;
  const ourProbability = clamp(0.5 + (Math.abs(signal.finalScore) / 200), 0.51, 0.85);

  // ===== EV CALCULATION =====

  const winAmount = (1 - price) * 1; // Win per $1 bet
  const loseAmount = price * 1; // Lose per $1 bet
  const ev = (ourProbability * winAmount) - ((1 - ourProbability) * loseAmount);

  if (ev <= 0) {
    return skip(`Negative EV (${ev.toFixed(4)})`, now);
  }

  // ===== KELLY CRITERION =====

  const b = winAmount / loseAmount; // Odds ratio
  const kelly = ((b * ourProbability) - (1 - ourProbability)) / b;
  const halfKelly = kelly * config.kellyFraction;

  // Risk adjustments
  let adjustedKelly = halfKelly;

  // Tilt reduction
  if (bankroll.consecutiveLosses >= config.tiltLevel1) {
    adjustedKelly *= 0.5;
  }
  if (bankroll.consecutiveLosses >= config.tiltLevel2) {
    adjustedKelly *= 0.25; // Cumulative: 0.125x
  }

  // Skip rounds after losses
  if (bankroll.consecutiveLosses >= config.tiltLevel1 && bankroll.consecutiveLosses < config.tiltLevel2) {
    // Skip 1 round after 3 losses — we implement this as reduced size
    adjustedKelly *= 0.5;
  }

  // Volatility reduction
  if (highVolatility) {
    adjustedKelly *= 0.5;
  }

  // Weekend reduction
  if (isWeekendLowLiquidity()) {
    adjustedKelly *= 0.5;
  }

  // Daily profit target reached — reduce size
  if (bankroll.dailyPnl > bankroll.dailyStartBalance * config.dailyProfitTarget) {
    adjustedKelly *= 0.5;
  }

  // Calculate bet size
  let betSize = bankroll.balance * adjustedKelly;
  betSize = clamp(betSize, config.minBet, bankroll.balance * config.maxBetPercent);

  // If balance is low, allow up to 80%
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

  logger.trade('Decision', `${action} $${betSize.toFixed(2)} @ ${price.toFixed(4)} | EV: ${ev.toFixed(4)} | Kelly: ${(adjustedKelly * 100).toFixed(1)}% | Conf: ${signal.confidence.toFixed(0)}`);

  return {
    action,
    direction,
    betSize: Math.round(betSize * 100) / 100,
    ev: Math.round(ev * 10000) / 10000,
    confidence: Math.round(signal.confidence * 100) / 100,
    score: Math.round(signal.finalScore * 100) / 100,
    ourProbability: Math.round(ourProbability * 10000) / 10000,
    kellyFraction: Math.round(adjustedKelly * 10000) / 10000,
    reason: `${action} — EV:${ev.toFixed(3)}, Conf:${signal.confidence.toFixed(0)}, Score:${signal.finalScore.toFixed(1)}`,
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

import { binanceWS } from '../websocket/BinanceWS.js';
import { streamManager } from '../websocket/StreamManager.js';
import { bankrollManager } from '../engine/BankrollManager.js';
import { riskManager } from './RiskManager.js';
import type { SystemStatus } from '../types/index.js';

export type ScenarioFlag =
  | 'NORMAL'
  | 'WS_DISCONNECTED'
  | 'API_UNREACHABLE'
  | 'BALANCE_LOW'
  | 'LOSING_STREAK'
  | 'HIGH_VOLATILITY'
  | 'LOW_VOLATILITY'
  | 'EXTREME_ODDS'
  | 'SIGNALS_CONFLICTING'
  | 'FAST_MOVING_MARKET'
  | 'MANIPULATION_SUSPECT'
  | 'USDC_DEPEG'
  | 'MARKET_UNAVAILABLE'
  | 'COLD_START'
  | 'DAILY_LOSS_LIMIT'
  | 'DAILY_PROFIT_TARGET';

interface ScenarioResult {
  flags: ScenarioFlag[];
  canTrade: boolean;
  suggestedStatus: SystemStatus;
  reason: string;
}

export function evaluateScenarios(): ScenarioResult {
  const flags: ScenarioFlag[] = [];
  let canTrade = true;
  let suggestedStatus: SystemStatus = 'RUNNING';
  const reasons: string[] = [];

  // Scenario 4: Binance WS disconnected
  if (!binanceWS.isConnected) {
    flags.push('WS_DISCONNECTED');
    canTrade = false;
    suggestedStatus = 'PAUSED';
    reasons.push('Binance WS disconnected');
  }

  // Scenario 6: Balance insufficient
  const bankroll = bankrollManager.getState();
  if (bankroll.balance < 1) {
    flags.push('BALANCE_LOW');
    canTrade = false;
    suggestedStatus = 'STOPPED';
    reasons.push(`Balance too low: $${bankroll.balance.toFixed(2)}`);
  }

  // Scenario 7: Losing streak
  if (bankroll.consecutiveLosses >= 3) {
    flags.push('LOSING_STREAK');
    if (bankroll.consecutiveLosses >= 8) {
      canTrade = false;
      suggestedStatus = 'STOPPED';
      reasons.push(`Tilt level 3: ${bankroll.consecutiveLosses} losses`);
    } else if (bankroll.consecutiveLosses >= 5) {
      reasons.push(`Tilt level 2: reduced betting, ${bankroll.consecutiveLosses} losses`);
    } else {
      reasons.push(`Tilt level 1: cautious mode, ${bankroll.consecutiveLosses} losses`);
    }
  }

  // Scenario 9: High volatility
  const risk = riskManager.getState();
  if (risk.condition === 'HIGH_VOLATILITY') {
    flags.push('HIGH_VOLATILITY');
    reasons.push('High volatility detected — raised thresholds');
  }

  // Scenario 10: Low volatility
  if (risk.condition === 'LOW_VOLATILITY') {
    flags.push('LOW_VOLATILITY');
    reasons.push('Low volatility — minimal edge, most rounds will SKIP');
  }

  // Scenario 17: Daily loss limit
  if (bankroll.dailyPnl < -(bankroll.dailyStartBalance * 0.20)) {
    flags.push('DAILY_LOSS_LIMIT');
    canTrade = false;
    suggestedStatus = 'STOPPED';
    reasons.push(`Daily loss limit hit: $${bankroll.dailyPnl.toFixed(2)}`);
  }

  // Scenario 17: Daily profit target
  if (bankroll.dailyPnl > bankroll.dailyStartBalance * 0.40) {
    flags.push('DAILY_PROFIT_TARGET');
    reasons.push('Daily profit target reached — reduced bet size');
  }

  // Scenario 24: Manipulation suspect
  if (risk.condition === 'MANIPULATION_SUSPECT') {
    flags.push('MANIPULATION_SUSPECT');
    canTrade = false;
    reasons.push('Manipulation suspected — skipping');
  }

  // Scenario 15: Stale data
  const futuresData = streamManager.getFuturesData();
  if (futuresData.lastUpdate > 0 && Date.now() - futuresData.lastUpdate > 60000) {
    reasons.push('Futures data stale (>60s old)');
  }

  // Risk manager skip
  const riskSkip = riskManager.shouldSkip();
  if (riskSkip.skip) {
    canTrade = false;
    reasons.push(riskSkip.reason);
  }

  if (flags.length === 0) flags.push('NORMAL');

  return {
    flags,
    canTrade,
    suggestedStatus,
    reason: reasons.join('; ') || 'Normal operation',
  };
}

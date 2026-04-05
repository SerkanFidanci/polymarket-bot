import type { BankrollState, BetResult } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { todayUTC } from '../utils/time.js';

const DEFAULT_BANKROLL: BankrollState = {
  balance: 50,
  initialBalance: 50,
  dailyStartBalance: 50,
  dailyPnl: 0,
  totalPnl: 0,
  totalBets: 0,
  wins: 0,
  losses: 0,
  consecutiveWins: 0,
  consecutiveLosses: 0,
  maxDrawdown: 0,
  peakBalance: 50,
  lastBetTime: null,
};

let state: BankrollState = { ...DEFAULT_BANKROLL };
let currentDate = todayUTC();
let listeners: ((s: BankrollState) => void)[] = [];

function emit() {
  for (const l of listeners) l({ ...state });
}

export const bankrollManager = {
  getState(): BankrollState {
    return { ...state };
  },

  init(initialBalance: number) {
    state = {
      ...DEFAULT_BANKROLL,
      balance: initialBalance,
      initialBalance,
      dailyStartBalance: initialBalance,
      peakBalance: initialBalance,
    };
    currentDate = todayUTC();
    logger.info('Bankroll', `Initialized with $${initialBalance.toFixed(2)}`);
    emit();
  },

  restore(saved: Partial<BankrollState>) {
    state = { ...state, ...saved };
    logger.info('Bankroll', `Restored — Balance: $${state.balance.toFixed(2)}, W/L: ${state.wins}/${state.losses}`);
    emit();
  },

  recordBet(result: BetResult, pnl: number) {
    state.totalBets++;
    state.lastBetTime = new Date().toISOString();

    if (result === 'WIN') {
      state.wins++;
      state.consecutiveWins++;
      state.consecutiveLosses = 0;
      state.balance += pnl;
      state.dailyPnl += pnl;
      state.totalPnl += pnl;
      logger.trade('Bankroll', `WIN +$${pnl.toFixed(2)} → Balance: $${state.balance.toFixed(2)}`);
    } else {
      state.losses++;
      state.consecutiveLosses++;
      state.consecutiveWins = 0;
      state.balance -= Math.abs(pnl);
      state.dailyPnl -= Math.abs(pnl);
      state.totalPnl -= Math.abs(pnl);
      logger.trade('Bankroll', `LOSS -$${Math.abs(pnl).toFixed(2)} → Balance: $${state.balance.toFixed(2)}`);
    }

    // Peak / drawdown tracking
    if (state.balance > state.peakBalance) {
      state.peakBalance = state.balance;
    }
    const drawdown = state.peakBalance > 0
      ? (state.peakBalance - state.balance) / state.peakBalance
      : 0;
    if (drawdown > state.maxDrawdown) {
      state.maxDrawdown = drawdown;
    }

    emit();
  },

  checkDailyReset() {
    const today = todayUTC();
    if (today !== currentDate) {
      logger.info('Bankroll', `Daily reset — Previous day P&L: $${state.dailyPnl.toFixed(2)}`);
      state.dailyStartBalance = state.balance;
      state.dailyPnl = 0;
      currentDate = today;
      emit();
    }
  },

  shouldStop(): { stop: boolean; reason: string } {
    // System stop loss
    if (state.balance < state.initialBalance * (1 - 0.75)) {
      return { stop: true, reason: `System stop loss: balance $${state.balance.toFixed(2)} < 25% of initial` };
    }
    // Balance too low
    if (state.balance < 1) {
      return { stop: true, reason: 'Balance below $1' };
    }
    // Tilt level 3
    if (state.consecutiveLosses >= 8) {
      return { stop: true, reason: `Tilt level 3: ${state.consecutiveLosses} consecutive losses` };
    }
    return { stop: false, reason: '' };
  },

  onChange(listener: (s: BankrollState) => void) {
    listeners.push(listener);
    return () => { listeners = listeners.filter(l => l !== listener); };
  },

  getWinRate(): number {
    const total = state.wins + state.losses;
    return total > 0 ? state.wins / total : 0;
  },

  getSharpeRatio(dailyReturns: number[]): number {
    if (dailyReturns.length < 2) return 0;
    const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / dailyReturns.length;
    const std = Math.sqrt(variance);
    return std === 0 ? 0 : mean / std;
  },
};

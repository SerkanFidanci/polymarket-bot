import { db } from './db/sqlite.js';
import { serverBinanceWS } from './binance-ws.js';
import { serverSignalEngine } from './signal-engine.js';
import type { CombinedSignal } from '../src/types/index.js';

// ===== TYPES =====

interface StrategyDecision {
  decision: 'BUY_UP' | 'BUY_DOWN' | 'SKIP';
  betPct: number; // fraction of balance
  reason?: string;
}

interface OpenPos {
  strategyName: string;
  roundId: number;
  direction: 'UP' | 'DOWN';
  entryPrice: number;
  betSize: number;
  peakPrice: number;
  roundEndTime: number;
}

interface ExitResult {
  shouldExit: boolean;
  reason: string;
  exitPrice: number;
}

interface RoundContext {
  signal: CombinedSignal;
  upPrice: number;
  downPrice: number;
  feeRate: number;
  roundEndTime: number;
  roundId: number;
  actualResult: string;
  timeIntoRound: number; // seconds since round start
}

// ===== STRATEGIES =====

const STRATEGIES: Array<{
  name: string;
  disabled?: boolean;
  shouldEnter: (ctx: RoundContext) => StrategyDecision;
  shouldExit: (pos: OpenPos, tokenPrice: number, timeLeftSec: number, signal: CombinedSignal | null) => ExitResult | null;
}> = [
  {
    // 1. AGGRESSIVE — medium threshold, stop-loss protected
    // CHANGED: score 10→15, conf 15→20, bet 3%→2%, min entry 15c
    name: 'AGGRESSIVE',
    shouldEnter(ctx) {
      const { signal, upPrice, downPrice } = ctx;
      if (!signal || upPrice < 0.05 || downPrice < 0.05) return { decision: 'SKIP', betPct: 0 };
      const absScore = Math.abs(signal.finalScore);
      if (absScore > 15 && signal.confidence > 20) {
        const dir = signal.finalScore > 0 ? 'UP' : 'DOWN';
        // Direction-specific threshold: BUY_UP has 36% WR vs BUY_DOWN 52% WR
        // Require stronger signal for UP to filter out weak longs
        if (dir === 'UP' && absScore <= 25) return { decision: 'SKIP', betPct: 0 };
        const price = dir === 'UP' ? upPrice : downPrice;
        if (price < 0.30) return { decision: 'SKIP', betPct: 0 }; // data: <30c = 0% WR
        const prob = Math.min(0.85, 0.5 + absScore / 200);
        const ev = (prob * (1 - price)) - ((1 - prob) * price) - ctx.feeRate;
        if (ev > 0) return { decision: dir === 'UP' ? 'BUY_UP' : 'BUY_DOWN', betPct: 0.02 };
      }
      return { decision: 'SKIP', betPct: 0 };
    },
    shouldExit() {
      // Hold to expiry — data shows exit manager destroys value on binary markets
      // Tokens dip mid-round then recover; stop-loss panics on temporary noise
      return null;
    },
  },
  {
    // 2. SELECTIVE — high quality, hold to expiry, DOWN only
    name: 'SELECTIVE',
    shouldEnter(ctx) {
      const { signal, upPrice, downPrice } = ctx;
      if (!signal || upPrice < 0.05 || downPrice < 0.05) return { decision: 'SKIP', betPct: 0 };
      const absScore = Math.abs(signal.finalScore);
      if (absScore > 20 && signal.confidence > 30 && signal.confidence <= 55) {
        const dir = signal.finalScore > 0 ? 'UP' : 'DOWN';
        // Only BUY_DOWN — UP signals consistently lose across all strategies
        if (dir === 'UP') return { decision: 'SKIP', betPct: 0 };
        const price = downPrice;
        if (price < 0.30 || price > 0.70) return { decision: 'SKIP', betPct: 0 }; // price floor
        const prob = Math.min(0.85, 0.5 + absScore / 200);
        const ev = (prob * (1 - price)) - ((1 - prob) * price) - ctx.feeRate;
        if (ev > 0) return { decision: 'BUY_DOWN', betPct: 0.05 };
      }
      return { decision: 'SKIP', betPct: 0 };
    },
    shouldExit() {
      // Hold to expiry — abs_floor_5c stop-loss destroyed $13.62 of value:
      // 6 of 7 triggered exits would have won at expiry. Binary tokens dip
      // mid-round then recover; any early exit panics on temporary noise.
      return null;
    },
  },
  {
    // 4. TREND_FOLLOWER — EMA+VWAP alignment, wider trailing stop
    // CHANGED: trailing stop 15%→25%
    name: 'TREND_FOLLOWER',
    shouldEnter(ctx) {
      const { signal, upPrice, downPrice } = ctx;
      if (!signal || upPrice < 0.05 || downPrice < 0.05) return { decision: 'SKIP', betPct: 0 };
      const emaMacd = signal.signals.ema_macd;
      const vwapBb = signal.signals.vwap_bb;
      const emaAligned = emaMacd && Math.sign(emaMacd.score) === Math.sign(signal.finalScore) && Math.abs(emaMacd.score) > 15;
      const vwapAligned = vwapBb && Math.sign(vwapBb.score) === Math.sign(signal.finalScore) && Math.abs(vwapBb.score) > 15;
      const trendAligned = (emaAligned || vwapAligned) && signal.confidence > 25;
      if (trendAligned) {
        const dir = signal.finalScore > 0 ? 'UP' : 'DOWN';
        const price = dir === 'UP' ? upPrice : downPrice;
        const prob = Math.min(0.85, 0.5 + Math.abs(signal.finalScore) / 200);
        const ev = (prob * (1 - price)) - ((1 - prob) * price) - ctx.feeRate;
        if (ev > 0) return { decision: dir === 'UP' ? 'BUY_UP' : 'BUY_DOWN', betPct: 0.04 };
      }
      return { decision: 'SKIP', betPct: 0 };
    },
    shouldExit() {
      // Hold to expiry — trailing stops destroy value on binary markets
      return null;
    },
  },
  {
    // 5. LATE_ENTRY — momentum trade, 15s exit (best performer)
    // CHANGED: score 15→12, price range 30-70→25-75, entry window 210→180
    name: 'LATE_ENTRY',
    shouldEnter(ctx) {
      const { signal, upPrice, downPrice, timeIntoRound } = ctx;
      if (!signal || upPrice < 0.05 || downPrice < 0.05) return { decision: 'SKIP', betPct: 0 };

      // Enter from 180s (was 210s) — more time for momentum
      if (timeIntoRound < 180) return { decision: 'SKIP', betPct: 0 };

      // Wider price range: 25-75c (was 30-70c)
      const price = signal.finalScore > 0 ? upPrice : downPrice;
      if (price < 0.25 || price > 0.75) return { decision: 'SKIP', betPct: 0 };

      const absScore = Math.abs(signal.finalScore);
      if (absScore > 12 && signal.confidence > 15) {
        const dir = signal.finalScore > 0 ? 'UP' : 'DOWN';
        // BUY_UP needs much higher score — UP loses -$5.60 vs DOWN +$2.80
        if (dir === 'UP' && absScore <= 25) return { decision: 'SKIP', betPct: 0 };
        return { decision: dir === 'UP' ? 'BUY_UP' : 'BUY_DOWN', betPct: 0.03 };
      }
      return { decision: 'SKIP', betPct: 0 };
    },
    shouldExit(_pos, _tokenPrice, timeLeftSec) {
      if (timeLeftSec <= 20) return { shouldExit: true, reason: 'time_20s_exit', exitPrice: _tokenPrice };
      return null;
    },
  },
];

// ===== OPEN POSITIONS =====

const openPositions = new Map<string, OpenPos>();
const tradedThisRound = new Set<string>(); // prevent re-entry after early exit

// ===== CORE FUNCTIONS =====

function ensureBalance(name: string): void {
  const exists = db.prepare('SELECT 1 FROM strategy_balances WHERE strategy_name = ?').get(name);
  if (!exists) {
    db.prepare('INSERT INTO strategy_balances (strategy_name, balance, total_pnl, wins, losses, total_trades, max_drawdown, peak_balance) VALUES (?, 50, 0, 0, 0, 0, 0, 50)').run(name);
  }
}

function getBalance(name: string): number {
  ensureBalance(name);
  const row = db.prepare('SELECT balance FROM strategy_balances WHERE strategy_name = ?').get(name) as { balance: number };
  return row.balance;
}

export const strategyManager = {
  // Called at round snapshot (60s in) — strategies decide entry
  evaluateEntries(ctx: RoundContext): void {
    for (const strat of STRATEGIES) {
      if (strat.disabled) continue;
      ensureBalance(strat.name);

      // Skip if already has open position this round
      if (openPositions.has(strat.name)) continue;

      // Prevent re-entry in same round (after early exit)
      if (tradedThisRound.has(strat.name)) continue;

      const balance = getBalance(strat.name);
      if (balance < 1) continue; // busted

      const decision = strat.shouldEnter(ctx);
      if (decision.decision === 'SKIP') continue;

      const dir = decision.decision === 'BUY_UP' ? 'UP' : 'DOWN';
      const entryPrice = dir === 'UP' ? ctx.upPrice : ctx.downPrice;
      if (entryPrice < 0.01) continue;

      const betSize = Math.max(1, Math.min(balance * decision.betPct, balance * 0.10));

      // Open position — mark as traded this round
      tradedThisRound.add(strat.name);
      openPositions.set(strat.name, {
        strategyName: strat.name,
        roundId: ctx.roundId,
        direction: dir as 'UP' | 'DOWN',
        entryPrice,
        betSize: Math.round(betSize * 100) / 100,
        peakPrice: entryPrice,
        roundEndTime: ctx.roundEndTime,
      });

      console.log(`[Strategy:${strat.name}] ENTER ${dir} @${(entryPrice * 100).toFixed(0)}¢ $${betSize.toFixed(2)}`);
    }
  },

  // Called every 5s — check exits
  checkExits(): void {
    const signal = serverSignalEngine.getLastSignal();

    for (const strat of STRATEGIES) {
      const pos = openPositions.get(strat.name);
      if (!pos) continue;

      const currentToken = pos.direction === 'UP' ? roundUpPriceGlobal : roundDownPriceGlobal;
      if (currentToken < 0.01) continue;

      // Update peak
      if (currentToken > pos.peakPrice) pos.peakPrice = currentToken;

      const timeLeftSec = Math.max(0, Math.floor((pos.roundEndTime - Date.now()) / 1000));

      const exitResult = strat.shouldExit(pos, currentToken, timeLeftSec, signal);
      if (exitResult && exitResult.shouldExit) {
        closePosition(strat.name, pos, exitResult.exitPrice, exitResult.reason, pos.direction);
      }
    }
  },

  // Called at round end — resolve remaining open positions
  resolveRound(actualResult: string, roundId: number): void {
    for (const strat of STRATEGIES) {
      const pos = openPositions.get(strat.name);
      if (!pos) continue;

      // Position still open → binary result
      const won = pos.direction === actualResult;
      closePosition(strat.name, pos, won ? 1.0 : 0.0, 'held_to_expiry', actualResult);
    }

    // Clear all positions and round locks
    openPositions.clear();
    tradedThisRound.clear();
  },

  getLeaderboard(): Array<{
    name: string; balance: number; totalPnl: number;
    wins: number; losses: number; totalTrades: number;
    winRate: number; maxDrawdown: number; score: number;
    insufficient: boolean;
  }> {
    const rows = db.prepare('SELECT * FROM strategy_balances ORDER BY total_pnl DESC').all() as Array<{
      strategy_name: string; balance: number; total_pnl: number;
      wins: number; losses: number; total_trades: number;
      max_drawdown: number; peak_balance: number;
    }>;

    // Also add BASELINE from training_rounds
    const baseline = computeBaselineStats();

    const all = [baseline, ...rows.map(r => ({
      name: r.strategy_name,
      balance: r.balance,
      totalPnl: r.total_pnl,
      wins: r.wins,
      losses: r.losses,
      totalTrades: r.total_trades,
      winRate: r.total_trades > 0 ? r.wins / r.total_trades : 0,
      maxDrawdown: r.max_drawdown,
    }))];

    return all.map(s => {
      const wr = s.winRate;
      const dd = s.maxDrawdown;
      let score = (s.totalPnl * 2) - (dd * 100 * 2) + (wr * 100 * 0.3);
      if (dd > 0.30) score *= 0.5;
      return {
        ...s,
        score: Math.round(score * 100) / 100,
        insufficient: s.totalTrades < 20,
      };
    }).sort((a, b) => b.score - a.score);
  },
};

// ===== HELPERS =====

// Global prices updated by training loop
let roundUpPriceGlobal = 0;
let roundDownPriceGlobal = 0;

export function setGlobalPrices(up: number, down: number): void {
  roundUpPriceGlobal = up;
  roundDownPriceGlobal = down;
}

// Single function for ALL position closes — both early exit and held-to-expiry
function closePosition(stratName: string, pos: OpenPos, exitPrice: number, reason: string, actualResult: string): void {
  const shares = pos.betSize / pos.entryPrice;
  const pnl = (exitPrice - pos.entryPrice) * shares;

  // Save trade
  db.prepare(`
    INSERT INTO strategy_trades (round_id, strategy_name, decision, entry_price, bet_size, exit_price, exit_reason, pnl, actual_result)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(pos.roundId, stratName, 'BUY_' + pos.direction, pos.entryPrice, pos.betSize, exitPrice, reason, pnl, actualResult);

  // Update balance
  ensureBalance(stratName);
  const won = pnl >= 0;
  const bal = db.prepare('SELECT * FROM strategy_balances WHERE strategy_name = ?').get(stratName) as {
    balance: number; peak_balance: number; max_drawdown: number;
  };
  const newBalance = bal.balance + pnl;
  const newPeak = Math.max(bal.peak_balance, newBalance);
  const dd = newPeak > 0 ? (newPeak - newBalance) / newPeak : 0;
  const newDD = Math.max(bal.max_drawdown, dd);

  db.prepare(`
    UPDATE strategy_balances SET
      balance = ?, total_pnl = total_pnl + ?, total_trades = total_trades + 1,
      wins = wins + ?, losses = losses + ?,
      peak_balance = ?, max_drawdown = ?
    WHERE strategy_name = ?
  `).run(newBalance, pnl, won ? 1 : 0, won ? 0 : 1, newPeak, newDD, stratName);

  openPositions.delete(stratName);
  console.log(`[Strategy:${stratName}] EXIT ${reason} | ${(pos.entryPrice * 100).toFixed(0)}¢→${(exitPrice * 100).toFixed(0)}¢ PnL:$${pnl.toFixed(2)} Bal:$${newBalance.toFixed(2)}`);
}

function computeBaselineStats() {
  const trades = db.prepare("SELECT * FROM training_rounds WHERE hypothetical_decision != 'SKIP' AND hypothetical_pnl IS NOT NULL ORDER BY id ASC").all() as Array<{
    hypothetical_decision: string; hypothetical_pnl: number; actual_result: string;
  }>;

  let balance = 50, peak = 50, maxDD = 0, wins = 0;
  for (const t of trades) {
    const dir = t.hypothetical_decision === 'BUY_UP' ? 'UP' : 'DOWN';
    if (dir === t.actual_result) wins++;
    balance += t.hypothetical_pnl || 0;
    if (balance > peak) peak = balance;
    const dd = peak > 0 ? (peak - balance) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    name: 'BASELINE',
    balance,
    totalPnl: balance - 50,
    wins,
    losses: trades.length - wins,
    totalTrades: trades.length,
    winRate: trades.length > 0 ? wins / trades.length : 0,
    maxDrawdown: maxDD,
  };
}

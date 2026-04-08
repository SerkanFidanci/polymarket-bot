import { db } from './db/sqlite.js';
import { serverBinanceWS } from './binance-ws.js';
import { serverSignalEngine } from './signal-engine.js';
import { getBtcMomentum, getPmMomentum, detectSpike, detectOracleLag } from './momentum-tracker.js';
import type { CombinedSignal } from '../src/types/index.js';

// Kötü saatler (UTC) — WR ve PnL verisi 800 round'dan
const BAD_HOURS = new Set([2, 4, 13, 17, 20]);

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
  entryTime: string; // ISO timestamp of actual entry moment
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

// ===== SHARED EXIT: signal_reversed (works on all strategies) =====
function smartExit(pos: OpenPos, tokenPrice: number, signal: CombinedSignal | null): ExitResult | null {
  if (!signal) return null;
  const isUp = pos.direction === 'UP';
  const sc = signal.finalScore;

  // Sinyal güçlü ters yöne döndüyse → çık
  if (isUp && sc < -15) return { shouldExit: true, reason: 'signal_reversed', exitPrice: tokenPrice };
  if (!isUp && sc > 15) return { shouldExit: true, reason: 'signal_reversed', exitPrice: tokenPrice };

  // %40+ düştü VE sinyal desteklemiyor → çık
  if (tokenPrice < pos.entryPrice * 0.60) {
    const stillOk = (isUp && sc > 5) || (!isUp && sc < -5);
    if (!stillOk) return { shouldExit: true, reason: 'dropping_no_support', exitPrice: tokenPrice };
  }
  return null;
}

// ===== SHARED: bad hour filter =====
function isBadHour(): boolean {
  return BAD_HOURS.has(new Date().getUTCHours());
}

// ===== STRATEGIES =====

const STRATEGIES: Array<{
  name: string;
  shouldEnter: (ctx: RoundContext) => StrategyDecision;
  shouldExit: (pos: OpenPos, tokenPrice: number, timeLeftSec: number, signal: CombinedSignal | null) => ExitResult | null;
}> = [
  {
    // 1. AGGRESSIVE
    name: 'AGGRESSIVE',
    shouldEnter(ctx) {
      if (isBadHour()) return { decision: 'SKIP', betPct: 0 };
      const { signal, upPrice, downPrice } = ctx;
      if (!signal || upPrice < 0.05 || downPrice < 0.05) return { decision: 'SKIP', betPct: 0 };
      const absScore = Math.abs(signal.finalScore);
      if (absScore > 15 && signal.confidence > 20) {
        const dir = signal.finalScore > 0 ? 'UP' : 'DOWN';
        if (dir === 'UP' && absScore <= 25) return { decision: 'SKIP', betPct: 0 };
        const price = dir === 'UP' ? upPrice : downPrice;
        if (price < 0.30) return { decision: 'SKIP', betPct: 0 };
        const prob = Math.min(0.85, 0.5 + absScore / 200);
        const ev = (prob * (1 - price)) - ((1 - prob) * price) - ctx.feeRate;
        if (ev > 0) return { decision: dir === 'UP' ? 'BUY_UP' : 'BUY_DOWN', betPct: 0.02 };
      }
      return { decision: 'SKIP', betPct: 0 };
    },
    shouldExit(pos, tokenPrice, _tl, signal) { return smartExit(pos, tokenPrice, signal); },
  },
  {
    // 2. TREND_FOLLOWER
    name: 'TREND_FOLLOWER',
    shouldEnter(ctx) {
      if (isBadHour()) return { decision: 'SKIP', betPct: 0 };
      const { signal, upPrice, downPrice } = ctx;
      if (!signal || upPrice < 0.05 || downPrice < 0.05) return { decision: 'SKIP', betPct: 0 };
      const emaMacd = signal.signals.ema_macd;
      const vwapBb = signal.signals.vwap_bb;
      const emaOk = emaMacd && Math.sign(emaMacd.score) === Math.sign(signal.finalScore) && Math.abs(emaMacd.score) > 15;
      const vwapOk = vwapBb && Math.sign(vwapBb.score) === Math.sign(signal.finalScore) && Math.abs(vwapBb.score) > 15;
      if ((emaOk || vwapOk) && signal.confidence > 25) {
        const dir = signal.finalScore > 0 ? 'UP' : 'DOWN';
        const price = dir === 'UP' ? upPrice : downPrice;
        if (price < 0.30 || price > 0.70) return { decision: 'SKIP', betPct: 0 };
        const prob = Math.min(0.85, 0.5 + Math.abs(signal.finalScore) / 200);
        const ev = (prob * (1 - price)) - ((1 - prob) * price) - ctx.feeRate;
        if (ev > 0) return { decision: dir === 'UP' ? 'BUY_UP' : 'BUY_DOWN', betPct: 0.04 };
      }
      return { decision: 'SKIP', betPct: 0 };
    },
    shouldExit(pos, tokenPrice, _tl, signal) { return smartExit(pos, tokenPrice, signal); },
  },
  {
    // 3. LATE_ENTRY — son 2dk giriş
    name: 'LATE_ENTRY',
    shouldEnter(ctx) {
      if (isBadHour()) return { decision: 'SKIP', betPct: 0 };
      const { signal, upPrice, downPrice, timeIntoRound } = ctx;
      if (!signal || upPrice < 0.05 || downPrice < 0.05) return { decision: 'SKIP', betPct: 0 };
      if (timeIntoRound < 180) return { decision: 'SKIP', betPct: 0 };
      const price = signal.finalScore > 0 ? upPrice : downPrice;
      if (price < 0.25 || price > 0.75) return { decision: 'SKIP', betPct: 0 };
      const absScore = Math.abs(signal.finalScore);
      if (absScore > 12 && signal.confidence > 15) {
        const dir = signal.finalScore > 0 ? 'UP' : 'DOWN';
        if (dir === 'UP' && absScore <= 25) return { decision: 'SKIP', betPct: 0 };
        return { decision: dir === 'UP' ? 'BUY_UP' : 'BUY_DOWN', betPct: 0.03 };
      }
      return { decision: 'SKIP', betPct: 0 };
    },
    shouldExit(pos, tokenPrice, _tl, signal) { return smartExit(pos, tokenPrice, signal); },
  },
  {
    // 4. INSTINCT — her round, tüm veriler + PM momentum
    name: 'INSTINCT',
    shouldEnter(ctx) {
      if (isBadHour()) return { decision: 'SKIP', betPct: 0 };
      const { signal, upPrice, downPrice } = ctx;
      if (!signal || upPrice < 0.05 || downPrice < 0.05) return { decision: 'SKIP', betPct: 0 };

      let score = 0;
      let reasons = 0;
      const sigs = signal.signals;

      // Trend (EMA)
      if (sigs.ema_macd && Math.abs(sigs.ema_macd.score) > 10) {
        score += sigs.ema_macd.score > 0 ? 2 : -2; reasons++;
      }
      // RSI aşırı alım/satım
      if (sigs.rsi_stoch) {
        const rsi = (sigs.rsi_stoch.details as any)?.rsi as number;
        if (rsi !== undefined) {
          if (rsi < 30) { score += 3; reasons++; }
          else if (rsi > 70) { score -= 3; reasons++; }
          else if (rsi < 40) { score += 1; reasons++; }
          else if (rsi > 60) { score -= 1; reasons++; }
        }
      }
      // CVD
      if (sigs.cvd && Math.abs(sigs.cvd.score) > 20) { score += sigs.cvd.score > 0 ? 2 : -2; reasons++; }
      // Whale
      if (sigs.whale && Math.abs(sigs.whale.score) > 30) { score += sigs.whale.score > 0 ? 2 : -2; reasons++; }
      // Orderbook
      if (sigs.orderbook && Math.abs(sigs.orderbook.score) > 30) { score += sigs.orderbook.score > 0 ? 1 : -1; reasons++; }
      // BB position
      if (sigs.vwap_bb) {
        const bbPos = (sigs.vwap_bb.details as any)?.bbPosition as number;
        if (bbPos !== undefined) {
          if (bbPos < 0.1) { score += 2; reasons++; }
          else if (bbPos > 0.9) { score -= 2; reasons++; }
        }
      }
      // Funding contrarian
      if (sigs.funding) {
        const rate = (sigs.funding.details as any)?.fundingRate as number;
        if (rate !== undefined) {
          if (rate > 0.0003) { score -= 1; reasons++; }
          else if (rate < -0.0001) { score += 1; reasons++; }
        }
      }
      // PM direction
      if (upPrice > 0.58) score += 1;
      else if (downPrice > 0.58) score -= 1;

      // PM MOMENTUM — yeni! PM fiyatı hızla bir yöne kayıyorsa güven artır
      const pmMom = getPmMomentum(30);
      if (pmMom) {
        if (pmMom.direction === 'UP') { score += 2; reasons++; }
        else if (pmMom.direction === 'DOWN') { score -= 2; reasons++; }
      }

      // BTC MOMENTUM
      const btcMom = getBtcMomentum(30);
      if (btcMom && Math.abs(btcMom.changePct) > 0.05) {
        score += btcMom.changePct > 0 ? 1 : -1;
        reasons++;
      }

      if (reasons < 2 || Math.abs(score) < 3) return { decision: 'SKIP', betPct: 0 };

      const dir = score > 0 ? 'UP' : 'DOWN';
      const price = dir === 'UP' ? upPrice : downPrice;
      if (price < 0.25 || price > 0.75) return { decision: 'SKIP', betPct: 0 };

      let betPct = 0.01;
      if (Math.abs(score) >= 5) betPct = 0.02;
      if (Math.abs(score) >= 8) betPct = 0.03;

      return { decision: dir === 'UP' ? 'BUY_UP' : 'BUY_DOWN', betPct };
    },
    shouldExit(pos, tokenPrice, _tl, signal) { return smartExit(pos, tokenPrice, signal); },
  },
  {
    // 5. MOMENTUM_RIDER — oracle lag + spike exploiter
    name: 'MOMENTUM_RIDER',
    shouldEnter(ctx) {
      if (isBadHour()) return { decision: 'SKIP', betPct: 0 };
      const { signal, upPrice, downPrice } = ctx;
      if (!signal || upPrice < 0.05 || downPrice < 0.05) return { decision: 'SKIP', betPct: 0 };

      // Oracle lag: BTC hareket etti ama PM henüz yansıtmadı
      const lag = detectOracleLag();
      if (lag.hasLag && lag.confidence > 30) {
        const dir = lag.btcDirection;
        const price = dir === 'UP' ? upPrice : downPrice;
        if (price >= 0.30 && price <= 0.65) {
          return { decision: dir === 'UP' ? 'BUY_UP' : 'BUY_DOWN', betPct: 0.03 };
        }
      }

      // Spike: BTC ani hareket (>%0.15 in 10s)
      const spike = detectSpike(10);
      if (spike.isSpike && spike.magnitude > 0.15) {
        const dir = spike.direction;
        const price = dir === 'UP' ? upPrice : downPrice;
        if (price >= 0.30 && price <= 0.60) {
          return { decision: dir === 'UP' ? 'BUY_UP' : 'BUY_DOWN', betPct: 0.03 };
        }
      }

      // Güçlü BTC momentum (30s'de %0.1+)
      const btcMom = getBtcMomentum(30);
      if (btcMom && Math.abs(btcMom.changePct) > 0.10) {
        const dir = btcMom.changePct > 0 ? 'UP' : 'DOWN';
        const price = dir === 'UP' ? upPrice : downPrice;
        if (price >= 0.30 && price <= 0.55) {
          // Sinyal de aynı yönde mi? Bonus güven
          const sigAgree = (dir === 'UP' && signal.finalScore > 5) || (dir === 'DOWN' && signal.finalScore < -5);
          if (sigAgree) return { decision: dir === 'UP' ? 'BUY_UP' : 'BUY_DOWN', betPct: 0.02 };
        }
      }

      return { decision: 'SKIP', betPct: 0 };
    },
    shouldExit(pos, tokenPrice, _tl, signal) { return smartExit(pos, tokenPrice, signal); },
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
        entryTime: new Date().toISOString(),
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

  // Save trade with real entry/exit timestamps
  const exitTime = new Date().toISOString();
  db.prepare(`
    INSERT INTO strategy_trades (round_id, strategy_name, decision, entry_price, bet_size, exit_price, exit_reason, pnl, actual_result, entry_time, exit_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(pos.roundId, stratName, 'BUY_' + pos.direction, pos.entryPrice, pos.betSize, exitPrice, reason, pnl, actualResult, pos.entryTime, exitTime);

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

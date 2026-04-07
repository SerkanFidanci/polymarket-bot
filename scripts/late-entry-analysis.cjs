const Database = require('better-sqlite3');
const db = new Database('C:/polymarket-bot/data/trading.db');

// 1. All LATE_ENTRY trades
console.log("=== ALL LATE_ENTRY TRADES ===");
const trades = db.prepare("SELECT * FROM strategy_trades WHERE strategy_name = 'LATE_ENTRY' ORDER BY id ASC").all();
console.log("Total trades: " + trades.length);
trades.forEach(t => {
  console.log("  id=" + t.id + " round=" + t.round_id + " " + t.decision + " entry=" + t.entry_price + " exit=" + t.exit_price + " reason=" + t.exit_reason + " pnl=" + t.pnl + " result=" + t.actual_result);
});

// 2. Summary stats
console.log("\n=== PERFORMANCE SUMMARY ===");
const wins = trades.filter(t => t.pnl >= 0);
const losses = trades.filter(t => t.pnl < 0);
console.log("Wins: " + wins.length + ", Losses: " + losses.length + ", Win Rate: " + (wins.length / trades.length * 100).toFixed(1) + "%");

const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
const avgPnl = totalPnl / trades.length;
const avgEntry = trades.reduce((s, t) => s + t.entry_price, 0) / trades.length;
const avgExit = trades.reduce((s, t) => s + t.exit_price, 0) / trades.length;
console.log("Total PnL: $" + totalPnl.toFixed(4));
console.log("Avg PnL per trade: $" + avgPnl.toFixed(4));
console.log("Avg Entry Price: " + (avgEntry * 100).toFixed(2) + "c");
console.log("Avg Exit Price: " + (avgExit * 100).toFixed(2) + "c");

// 3. Exit reason breakdown
console.log("\n=== EXIT REASONS ===");
const reasons = {};
trades.forEach(t => { reasons[t.exit_reason] = (reasons[t.exit_reason] || 0) + 1; });
Object.entries(reasons).forEach(([r, c]) => console.log("  " + r + ": " + c));

// 3b. PnL by exit reason
console.log("\n=== PNL BY EXIT REASON ===");
const reasonPnl = {};
const reasonTrades = {};
trades.forEach(t => {
  if (!reasonPnl[t.exit_reason]) { reasonPnl[t.exit_reason] = 0; reasonTrades[t.exit_reason] = []; }
  reasonPnl[t.exit_reason] += t.pnl;
  reasonTrades[t.exit_reason].push(t);
});
Object.entries(reasonPnl).forEach(([r, p]) => {
  const ct = reasonTrades[r].length;
  const w = reasonTrades[r].filter(t => t.pnl >= 0).length;
  console.log("  " + r + ": total_pnl=$" + p.toFixed(4) + ", trades=" + ct + ", win_rate=" + (w / ct * 100).toFixed(1) + "%");
});

// 4. 15-second exit analysis
console.log("\n=== 15-SEC EXIT vs HOLD-TO-EXPIRY ANALYSIS ===");
const earlyExits = trades.filter(t => t.exit_reason === 'time_15s_exit');
let earlyExitPnl = 0;
let holdToExpiryPnl = 0;
earlyExits.forEach(t => {
  earlyExitPnl += t.pnl;
  const dir = t.decision === 'BUY_UP' ? 'UP' : 'DOWN';
  const won = dir === t.actual_result;
  const shares = t.bet_size / t.entry_price;
  const hypotheticalPnl = ((won ? 1.0 : 0.0) - t.entry_price) * shares;
  holdToExpiryPnl += hypotheticalPnl;
});
console.log("Early exit (15s) total PnL: $" + earlyExitPnl.toFixed(4));
console.log("Hold-to-expiry hypothetical PnL: $" + holdToExpiryPnl.toFixed(4));
console.log("Difference (hold minus early): $" + (holdToExpiryPnl - earlyExitPnl).toFixed(4));

// Breakdown winning vs losing early exits
const earlyWins = earlyExits.filter(t => {
  const dir = t.decision === 'BUY_UP' ? 'UP' : 'DOWN';
  return dir === t.actual_result;
});
const earlyLosses = earlyExits.filter(t => {
  const dir = t.decision === 'BUY_UP' ? 'UP' : 'DOWN';
  return dir !== t.actual_result;
});
console.log("\nOf early exits: " + earlyWins.length + " would have WON at expiry, " + earlyLosses.length + " would have LOST");

let earlyWinPnl = 0;
let earlyWinHold = 0;
earlyWins.forEach(t => {
  earlyWinPnl += t.pnl;
  const shares = t.bet_size / t.entry_price;
  earlyWinHold += (1.0 - t.entry_price) * shares;
});
console.log("Winning trades: early_exit_pnl=$" + earlyWinPnl.toFixed(4) + ", hold_pnl=$" + earlyWinHold.toFixed(4) + ", missed=$" + (earlyWinHold - earlyWinPnl).toFixed(4));

let earlyLossPnl = 0;
let earlyLossHold = 0;
earlyLosses.forEach(t => {
  earlyLossPnl += t.pnl;
  const shares = t.bet_size / t.entry_price;
  earlyLossHold += (0.0 - t.entry_price) * shares;
});
console.log("Losing trades: early_exit_pnl=$" + earlyLossPnl.toFixed(4) + ", hold_pnl=$" + earlyLossHold.toFixed(4) + ", saved=$" + (earlyLossPnl - earlyLossHold).toFixed(4));

// 5. Price range analysis
console.log("\n=== ENTRY PRICE DISTRIBUTION ===");
const brackets = { '<30c': 0, '30-40c': 0, '40-50c': 0, '50-60c': 0, '60-70c': 0, '>70c': 0 };
trades.forEach(t => {
  const p = t.entry_price;
  if (p < 0.30) brackets['<30c']++;
  else if (p < 0.40) brackets['30-40c']++;
  else if (p < 0.50) brackets['40-50c']++;
  else if (p < 0.60) brackets['50-60c']++;
  else if (p < 0.70) brackets['60-70c']++;
  else brackets['>70c']++;
});
Object.entries(brackets).forEach(([b, c]) => console.log("  " + b + ": " + c + " trades"));

// PnL by price bracket
console.log("\n=== PNL BY ENTRY PRICE BRACKET ===");
const bracketPnl = { '30-40c': [], '40-50c': [], '50-60c': [], '60-70c': [] };
trades.forEach(t => {
  const p = t.entry_price;
  if (p >= 0.30 && p < 0.40) bracketPnl['30-40c'].push(t);
  else if (p >= 0.40 && p < 0.50) bracketPnl['40-50c'].push(t);
  else if (p >= 0.50 && p < 0.60) bracketPnl['50-60c'].push(t);
  else if (p >= 0.60 && p < 0.70) bracketPnl['60-70c'].push(t);
});
Object.entries(bracketPnl).forEach(([b, arr]) => {
  if (arr.length === 0) return;
  const p = arr.reduce((s, t) => s + t.pnl, 0);
  const w = arr.filter(t => t.pnl >= 0).length;
  console.log("  " + b + ": " + arr.length + " trades, total_pnl=$" + p.toFixed(4) + ", win_rate=" + (w / arr.length * 100).toFixed(1) + "%, avg_pnl=$" + (p / arr.length).toFixed(4));
});

// 6. Compare all strategies
console.log("\n=== ALL STRATEGIES COMPARISON ===");
const allStrats = db.prepare(
  "SELECT strategy_name, COUNT(*) as trades, SUM(CASE WHEN pnl >= 0 THEN 1 ELSE 0 END) as wins, SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losses, SUM(pnl) as total_pnl, AVG(pnl) as avg_pnl, MIN(pnl) as worst_trade, MAX(pnl) as best_trade FROM strategy_trades GROUP BY strategy_name ORDER BY SUM(pnl) DESC"
).all();
allStrats.forEach(s => {
  console.log("  " + s.strategy_name + ": trades=" + s.trades + " wins=" + s.wins + " losses=" + s.losses + " wr=" + (s.wins / s.trades * 100).toFixed(1) + "% total_pnl=$" + s.total_pnl.toFixed(4) + " avg_pnl=$" + s.avg_pnl.toFixed(4) + " worst=$" + s.worst_trade.toFixed(4) + " best=$" + s.best_trade.toFixed(4));
});

// 7. Risk-adjusted metrics
console.log("\n=== RISK-ADJUSTED RETURNS (SHARPE-LIKE) ===");
allStrats.forEach(s => {
  const stTrades = db.prepare("SELECT pnl FROM strategy_trades WHERE strategy_name = ?").all(s.strategy_name);
  const pnls = stTrades.map(t => t.pnl);
  const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
  const variance = pnls.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / pnls.length;
  const stddev = Math.sqrt(variance);
  const sharpe = stddev > 0 ? mean / stddev : 0;

  const grossWin = pnls.filter(p => p >= 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(pnls.filter(p => p < 0).reduce((a, b) => a + b, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : Infinity;

  // Max consecutive losses
  let maxConsecLoss = 0;
  let curConsecLoss = 0;
  pnls.forEach(p => {
    if (p < 0) { curConsecLoss++; maxConsecLoss = Math.max(maxConsecLoss, curConsecLoss); }
    else curConsecLoss = 0;
  });

  console.log("  " + s.strategy_name + ": sharpe=" + sharpe.toFixed(4) + " stddev=$" + stddev.toFixed(4) + " profit_factor=" + profitFactor.toFixed(2) + " avg=$" + mean.toFixed(4) + " max_consec_loss=" + maxConsecLoss);
});

// 8. Leaderboard (balance + score)
console.log("\n=== STRATEGY BALANCES (LEADERBOARD) ===");
const balances = db.prepare("SELECT * FROM strategy_balances ORDER BY balance DESC").all();
balances.forEach(b => {
  const wr = b.total_trades > 0 ? (b.wins / b.total_trades * 100).toFixed(1) : '0.0';
  const wrPct = b.total_trades > 0 ? b.wins / b.total_trades : 0;
  var score = (b.total_pnl * 2) - (b.max_drawdown * 100 * 2) + (wrPct * 100 * 0.3);
  if (b.max_drawdown > 0.30) score *= 0.5;
  console.log("  " + b.strategy_name + ": bal=$" + b.balance.toFixed(2) + " pnl=$" + b.total_pnl.toFixed(2) + " wr=" + wr + "% dd=" + (b.max_drawdown * 100).toFixed(1) + "% score=" + score.toFixed(2) + " trades=" + b.total_trades);
});

// 9. Direction accuracy
console.log("\n=== LATE_ENTRY DIRECTION ACCURACY ===");
const leUp = trades.filter(t => t.decision === 'BUY_UP');
const leDn = trades.filter(t => t.decision === 'BUY_DOWN');
const upWins = leUp.filter(t => t.actual_result === 'UP').length;
const dnWins = leDn.filter(t => t.actual_result === 'DOWN').length;
console.log("BUY_UP: " + leUp.length + " trades, " + upWins + " correct (" + (leUp.length > 0 ? (upWins / leUp.length * 100).toFixed(1) : '0.0') + "%)");
console.log("BUY_DOWN: " + leDn.length + " trades, " + dnWins + " correct (" + (leDn.length > 0 ? (dnWins / leDn.length * 100).toFixed(1) : '0.0') + "%)");

// 10. Held-to-expiry vs early exit comparison
console.log("\n=== HELD-TO-EXPIRY TRADES (for comparison) ===");
const heldTrades = trades.filter(t => t.exit_reason === 'held_to_expiry');
if (heldTrades.length > 0) {
  const heldPnl = heldTrades.reduce((s, t) => s + t.pnl, 0);
  const heldWins = heldTrades.filter(t => t.pnl >= 0).length;
  console.log("Held-to-expiry: " + heldTrades.length + " trades, pnl=$" + heldPnl.toFixed(4) + ", win_rate=" + (heldWins / heldTrades.length * 100).toFixed(1) + "%");
} else {
  console.log("No held-to-expiry trades");
}

// 11. Consecutive win/loss streaks
console.log("\n=== LATE_ENTRY STREAKS ===");
let maxWinStreak = 0, maxLossStreak = 0, curWin = 0, curLoss = 0;
trades.forEach(t => {
  if (t.pnl >= 0) { curWin++; curLoss = 0; maxWinStreak = Math.max(maxWinStreak, curWin); }
  else { curLoss++; curWin = 0; maxLossStreak = Math.max(maxLossStreak, curLoss); }
});
console.log("Max win streak: " + maxWinStreak);
console.log("Max loss streak: " + maxLossStreak);

// 12. Equity curve
console.log("\n=== LATE_ENTRY EQUITY CURVE ===");
let equity = 50;
let peak = 50;
let maxDD = 0;
trades.forEach((t, i) => {
  equity += t.pnl;
  if (equity > peak) peak = equity;
  const dd = peak > 0 ? (peak - equity) / peak : 0;
  if (dd > maxDD) maxDD = dd;
  if (i % 10 === 0 || i === trades.length - 1) {
    console.log("  trade " + (i + 1) + ": equity=$" + equity.toFixed(2) + " peak=$" + peak.toFixed(2) + " dd=" + (dd * 100).toFixed(1) + "%");
  }
});
console.log("Max drawdown: " + (maxDD * 100).toFixed(1) + "%");

db.close();

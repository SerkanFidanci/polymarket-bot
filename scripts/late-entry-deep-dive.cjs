const Database = require('better-sqlite3');
const db = new Database('C:/polymarket-bot/data/trading.db');

// Deep dive into each LATE_ENTRY trade
console.log("=== DETAILED TRADE ANALYSIS ===\n");
const trades = db.prepare("SELECT * FROM strategy_trades WHERE strategy_name = 'LATE_ENTRY' ORDER BY id ASC").all();

trades.forEach((t, i) => {
  const dir = t.decision === 'BUY_UP' ? 'UP' : 'DOWN';
  const won = dir === t.actual_result;
  const shares = t.bet_size / t.entry_price;
  const holdPnl = ((won ? 1.0 : 0.0) - t.entry_price) * shares;
  const earlyPnl = t.pnl;

  console.log("Trade " + (i+1) + ": Round #" + t.round_id);
  console.log("  Direction: " + t.decision + " -> Actual result: " + t.actual_result + " -> " + (won ? "CORRECT" : "WRONG"));
  console.log("  Entry: " + (t.entry_price * 100).toFixed(1) + "c -> Exit: " + (t.exit_price * 100).toFixed(1) + "c");
  console.log("  Bet size: $" + t.bet_size.toFixed(2) + " | Shares: " + shares.toFixed(2));
  console.log("  Exit reason: " + t.exit_reason);
  console.log("  Actual PnL (15s exit): $" + earlyPnl.toFixed(4));
  console.log("  Hypothetical PnL (hold): $" + holdPnl.toFixed(4));
  console.log("  Early exit was " + (earlyPnl > holdPnl ? "BETTER" : "WORSE") + " by $" + Math.abs(earlyPnl - holdPnl).toFixed(4));
  console.log("");
});

// KEY INSIGHT: Trade #1 and #2 are BUY_DOWN but result was UP
// They made money because exit_price > entry_price even though direction was wrong
console.log("=== KEY INSIGHT: WHY WRONG-DIRECTION TRADES PROFITED ===\n");
const wrongDirWins = trades.filter(t => {
  const dir = t.decision === 'BUY_UP' ? 'UP' : 'DOWN';
  return dir !== t.actual_result && t.pnl > 0;
});
wrongDirWins.forEach(t => {
  console.log("Trade round=" + t.round_id + ": " + t.decision + " but result=" + t.actual_result);
  console.log("  Entry: " + (t.entry_price * 100).toFixed(1) + "c, Exit at 15s: " + (t.exit_price * 100).toFixed(1) + "c");
  console.log("  Price ROSE by " + ((t.exit_price - t.entry_price) * 100).toFixed(1) + "c");
  console.log("  This means DOWN token price went UP temporarily before round ended as UP");
  console.log("  The 15s exit captured this temporary price movement!");
  console.log("  If held to expiry: DOWN token -> 0c = TOTAL LOSS");
  console.log("");
});

// Compare LATE_ENTRY signal thresholds to other strategies
console.log("=== ENTRY THRESHOLD COMPARISON ===");
console.log("  LATE_ENTRY: absScore > 15, confidence > 20, timeIntoRound >= 210, price 30-70c");
console.log("  AGGRESSIVE: absScore > 10, confidence > 15, no time filter, any price > 5c");
console.log("  SELECTIVE:  absScore > 25, confidence 35-50, no time filter, any price > 5c");
console.log("  CONTRARIAN: price > 75c extreme, absScore > 10 opposing, any time");
console.log("  TREND_FOLLOWER: ema_macd + vwap_bb aligned, absScore > 15, confidence > 25");

// What rounds did LATE_ENTRY skip?
console.log("\n=== ROUNDS WHERE LATE_ENTRY SKIPPED ===");
const allRounds = db.prepare("SELECT DISTINCT round_id FROM strategy_trades ORDER BY round_id ASC").all();
const lateRounds = new Set(trades.map(t => t.round_id));
const skippedRounds = allRounds.filter(r => !lateRounds.has(r.round_id));
console.log("Traded in " + trades.length + " rounds, skipped " + skippedRounds.length + " rounds where other strategies traded");

// Show what other strategies did in rounds LATE_ENTRY traded
console.log("\n=== OTHER STRATEGIES IN LATE_ENTRY ROUNDS ===");
trades.forEach(t => {
  const others = db.prepare("SELECT * FROM strategy_trades WHERE round_id = ? AND strategy_name != 'LATE_ENTRY'").all(t.round_id);
  console.log("Round " + t.round_id + " (LATE_ENTRY: pnl=$" + t.pnl.toFixed(4) + "):");
  others.forEach(o => {
    console.log("  " + o.strategy_name + ": " + o.decision + " pnl=$" + o.pnl.toFixed(4) + " exit=" + o.exit_reason);
  });
  if (others.length === 0) console.log("  (no other strategies traded)");
});

// Score breakdown
console.log("\n=== SCORE FORMULA BREAKDOWN ===");
console.log("Score = (totalPnl * 2) - (maxDrawdown * 100 * 2) + (winRate * 100 * 0.3)");
console.log("If maxDrawdown > 30%, score *= 0.5 (penalty)");
console.log("");
const balances = db.prepare("SELECT * FROM strategy_balances ORDER BY balance DESC").all();
balances.forEach(b => {
  const wrPct = b.total_trades > 0 ? b.wins / b.total_trades : 0;
  const pnlComponent = b.total_pnl * 2;
  const ddComponent = b.max_drawdown * 100 * 2;
  const wrComponent = wrPct * 100 * 0.3;
  var score = pnlComponent - ddComponent + wrComponent;
  const penalized = b.max_drawdown > 0.30;
  if (penalized) score *= 0.5;
  console.log("  " + b.strategy_name + ":");
  console.log("    PnL component:  " + pnlComponent.toFixed(2) + " (pnl=$" + b.total_pnl.toFixed(2) + " * 2)");
  console.log("    DD component:  -" + ddComponent.toFixed(2) + " (dd=" + (b.max_drawdown * 100).toFixed(1) + "% * 2)");
  console.log("    WR component:  +" + wrComponent.toFixed(2) + " (wr=" + (wrPct * 100).toFixed(1) + "% * 0.3)");
  console.log("    Penalty:       " + (penalized ? "YES (x0.5)" : "NO"));
  console.log("    FINAL SCORE:   " + score.toFixed(2));
  console.log("");
});

db.close();

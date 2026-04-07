const Database = require('better-sqlite3');
const db = new Database('C:/polymarket-bot/data/trading.db');

// Check the actual_result column - it's always 'UP' for LATE_ENTRY, is that suspicious?
console.log("=== ACTUAL RESULT DISTRIBUTION (LATE_ENTRY) ===");
const trades = db.prepare("SELECT actual_result, COUNT(*) as cnt FROM strategy_trades WHERE strategy_name = 'LATE_ENTRY' GROUP BY actual_result").all();
trades.forEach(t => console.log("  " + t.actual_result + ": " + t.cnt));

// What about all strategies?
console.log("\n=== ACTUAL RESULT DISTRIBUTION (ALL) ===");
const all = db.prepare("SELECT actual_result, COUNT(*) as cnt FROM strategy_trades GROUP BY actual_result").all();
all.forEach(t => console.log("  " + t.actual_result + ": " + t.cnt));

// Check if the exit_reason is always time_15s_exit -- understand flow
console.log("\n=== EXIT FLOW ANALYSIS ===");
console.log("LATE_ENTRY enters at timeIntoRound >= 210 (last 90s of 300s round)");
console.log("It exits at timeLeftSec <= 15");
console.log("So max holding time = ~90s - 15s = ~75s");
console.log("This means it never holds to expiry -- always exits at 15s before end");

// The BUY_DOWN trades in rounds 414, 415 -- signal said DOWN but result was UP
// But the DOWN token price ROSE during those 75 seconds
// This is the key mechanism: late entry captures price momentum, not binary outcome
console.log("\n=== MECHANISM ANALYSIS ===");
console.log("Trade 1 (Round 414): BUY_DOWN at 64c, exit at 95.5c (+31.5c gain)");
console.log("  -> DOWN token rose 49% in ~75s. Direction was WRONG (result=UP)");
console.log("  -> If held: $-1.50 total loss. 15s exit saved $2.24");
console.log("");
console.log("Trade 2 (Round 415): BUY_DOWN at 44.5c, exit at 65.5c (+21c gain)");
console.log("  -> DOWN token rose 47% in ~75s. Direction was WRONG (result=UP)");
console.log("  -> If held: $-1.52 total loss. 15s exit saved $2.24");
console.log("");
console.log("Trade 3 (Round 429): BUY_UP at 55.5c, exit at 54.5c (-1c loss)");
console.log("  -> UP token dropped 2% in ~75s. Direction was CORRECT (result=UP)");
console.log("  -> If held: $+1.23 gain. 15s exit cost $1.26 in missed profit");
console.log("");
console.log("Trade 4 (Round 436): BUY_UP at 31.5c, exit at 95.5c (+64c gain)");
console.log("  -> UP token rose 203% in ~75s. Direction was CORRECT (result=UP)");
console.log("  -> If held: $+3.35. 15s exit only missed $0.22 (price was already 95.5c)");

// Total round data for context
console.log("\n=== TOTAL ROUNDS IN TRAINING DATA ===");
const roundCount = db.prepare("SELECT COUNT(DISTINCT round_id) as cnt FROM training_rounds").get();
console.log("Total training rounds: " + roundCount.cnt);
const roundsWithTrades = db.prepare("SELECT COUNT(DISTINCT round_id) as cnt FROM strategy_trades").get();
console.log("Rounds with at least one strategy trade: " + roundsWithTrades.cnt);

// What is the overall UP vs DOWN ratio in training data?
console.log("\n=== OVERALL MARKET DIRECTION BIAS ===");
const results = db.prepare("SELECT actual_result, COUNT(*) as cnt FROM training_rounds WHERE actual_result IS NOT NULL GROUP BY actual_result").all();
results.forEach(r => console.log("  " + r.actual_result + ": " + r.cnt));

// How does LATE_ENTRY compare per-trade to AGGRESSIVE (its main competitor)?
console.log("\n=== PER-TRADE COMPARISON: LATE_ENTRY vs AGGRESSIVE ===");
const aggTrades = db.prepare("SELECT * FROM strategy_trades WHERE strategy_name = 'AGGRESSIVE' ORDER BY id ASC").all();
const lateTrades = db.prepare("SELECT * FROM strategy_trades WHERE strategy_name = 'LATE_ENTRY' ORDER BY id ASC").all();

console.log("LATE_ENTRY:");
console.log("  Trades: " + lateTrades.length);
console.log("  Win rate: 75.0%");
console.log("  Avg PnL: $" + (lateTrades.reduce((s,t) => s + t.pnl, 0) / lateTrades.length).toFixed(4));
console.log("  Worst trade: $" + Math.min(...lateTrades.map(t => t.pnl)).toFixed(4));
console.log("  Best trade: $" + Math.max(...lateTrades.map(t => t.pnl)).toFixed(4));
console.log("  All exits: time_15s_exit");

console.log("\nAGGRESSIVE:");
console.log("  Trades: " + aggTrades.length);
const aggWins = aggTrades.filter(t => t.pnl >= 0).length;
console.log("  Win rate: " + (aggWins/aggTrades.length*100).toFixed(1) + "%");
console.log("  Avg PnL: $" + (aggTrades.reduce((s,t) => s + t.pnl, 0) / aggTrades.length).toFixed(4));
console.log("  Worst trade: $" + Math.min(...aggTrades.map(t => t.pnl)).toFixed(4));
console.log("  Best trade: $" + Math.max(...aggTrades.map(t => t.pnl)).toFixed(4));
const aggReasons = {};
aggTrades.forEach(t => { aggReasons[t.exit_reason] = (aggReasons[t.exit_reason] || 0) + 1; });
console.log("  Exit reasons: " + JSON.stringify(aggReasons));

// Would widening the price range help LATE_ENTRY?
console.log("\n=== WIDENED PRICE RANGE SIMULATION ===");
console.log("Current filter: 30-70c. Checking what trades at 20-80c would look like...");
// We can check training_rounds for rounds where LATE_ENTRY could have traded
const allTrainingRounds = db.prepare("SELECT * FROM training_rounds WHERE actual_result IS NOT NULL ORDER BY id ASC").all();
console.log("Note: Cannot simulate perfectly -- training_rounds may not have 210s+ snapshots");
console.log("But we know from 4 trades: entry prices were 31.5c, 44.5c, 55.5c, 64.0c");
console.log("All within 30-70c range, so widening would only add trades outside this range");
console.log("Lower-price entries (20-30c) have higher upside if correct ($1 payout)");
console.log("Higher-price entries (70-80c) have lower upside but higher probability");

db.close();

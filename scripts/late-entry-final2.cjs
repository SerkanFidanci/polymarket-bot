const Database = require('better-sqlite3');
const db = new Database('C:/polymarket-bot/data/trading.db');

// Check schema
console.log("=== TABLE SCHEMAS ===");
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
tables.forEach(t => {
  console.log("\n" + t.name + ":");
  const cols = db.prepare("PRAGMA table_info(" + t.name + ")").all();
  cols.forEach(c => console.log("  " + c.name + " " + c.type));
});

// Total rounds
console.log("\n=== TOTAL ROUNDS IN TRAINING DATA ===");
const roundCount = db.prepare("SELECT COUNT(*) as cnt FROM training_rounds").get();
console.log("Total training rounds: " + roundCount.cnt);

// Overall market direction
console.log("\n=== OVERALL MARKET DIRECTION BIAS ===");
const results = db.prepare("SELECT actual_result, COUNT(*) as cnt FROM training_rounds WHERE actual_result IS NOT NULL GROUP BY actual_result").all();
results.forEach(r => console.log("  " + r.actual_result + ": " + r.cnt));

// All strategy_trades rounds
const roundsWithTrades = db.prepare("SELECT COUNT(DISTINCT round_id) as cnt FROM strategy_trades").get();
console.log("\nRounds with strategy trades: " + roundsWithTrades.cnt);

db.close();

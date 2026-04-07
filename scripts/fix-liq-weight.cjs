const Database = require("better-sqlite3");
const db = new Database("data/trading.db");

const opt = db.prepare("SELECT id, new_weights FROM optimization_history WHERE applied = 1 ORDER BY id DESC LIMIT 1").get();
const weights = JSON.parse(opt.new_weights);
console.log("Mevcut liquidation:", weights.liquidation);

weights.liquidation = 0;
const sum = Object.values(weights).reduce((a,b)=>a+b,0);
for (const k of Object.keys(weights)) {
  if (k !== "liquidation" && weights[k] > 0) weights[k] /= sum;
}
weights.liquidation = 0;

db.prepare(
  "INSERT INTO optimization_history (timestamp, optimization_type, rounds_analyzed, old_weights, new_weights, old_simulated_pnl, new_simulated_pnl, improvement_percent, applied, reason) VALUES (datetime('now'), 'manual', 0, ?, ?, 0, 0, 0, 1, 'Fix: liquidation weight back to 0')"
).run(opt.new_weights, JSON.stringify(weights));

console.log("Fixed. New top weights:");
Object.entries(weights).sort((a,b)=>b[1]-a[1]).slice(0,5).forEach(([k,v])=>console.log("  "+k+": "+(v*100).toFixed(1)+"%"));

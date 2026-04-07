const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'data', 'trading.db'));

console.log('===== SELECTIVE STRATEGY ANALYSIS =====\n');

// 1. All SELECTIVE trades
console.log('--- 1. SELECTIVE TRADES ---');
const trades = db.prepare("SELECT * FROM strategy_trades WHERE strategy_name = 'SELECTIVE' ORDER BY id ASC").all();
if (trades.length === 0) {
  console.log('NO TRADES FOUND.\n');
} else {
  for (const t of trades) {
    console.log(`  id=${t.id} round=${t.round_id} decision=${t.decision} entry=${t.entry_price} exit=${t.exit_price} reason=${t.exit_reason} pnl=${t.pnl} result=${t.actual_result}`);
  }
  console.log(`  Total trades: ${trades.length}\n`);
}

// 2. Rounds matching SELECTIVE entry criteria (score>25, conf>35 AND conf<=50, price>0.01)
console.log('--- 2. ROUNDS MATCHING SELECTIVE CRITERIA ---');
const matchingCount = db.prepare("SELECT COUNT(*) as cnt FROM training_rounds WHERE ABS(final_score) > 25 AND confidence > 35 AND confidence <= 50 AND polymarket_up_price > 0.01").get();
console.log(`  Rounds with |score|>25, 35<conf<=50, price>0.01: ${matchingCount.cnt}\n`);

// 3. Total rounds for context
console.log('--- 3. TOTAL ROUNDS + OPPORTUNITY ANALYSIS ---');
const totalRounds = db.prepare("SELECT COUNT(*) as cnt FROM training_rounds").get();
const roundsWithSignals = db.prepare("SELECT COUNT(*) as cnt FROM training_rounds WHERE final_score IS NOT NULL").get();
const roundsWithPrice = db.prepare("SELECT COUNT(*) as cnt FROM training_rounds WHERE polymarket_up_price > 0.01").get();
console.log(`  Total rounds: ${totalRounds.cnt}`);
console.log(`  Rounds with signals: ${roundsWithSignals.cnt}`);
console.log(`  Rounds with PM price > 0.01: ${roundsWithPrice.cnt}`);

// Break down each filter
const scoreGt25 = db.prepare("SELECT COUNT(*) as cnt FROM training_rounds WHERE ABS(final_score) > 25 AND polymarket_up_price > 0.01").get();
const confGt35 = db.prepare("SELECT COUNT(*) as cnt FROM training_rounds WHERE confidence > 35 AND polymarket_up_price > 0.01").get();
const confLe50 = db.prepare("SELECT COUNT(*) as cnt FROM training_rounds WHERE confidence <= 50 AND polymarket_up_price > 0.01").get();
const confBand = db.prepare("SELECT COUNT(*) as cnt FROM training_rounds WHERE confidence > 35 AND confidence <= 50 AND polymarket_up_price > 0.01").get();
console.log(`\n  Filter breakdown (rounds with PM price > 0.01):`);
console.log(`    |score| > 25:          ${scoreGt25.cnt}`);
console.log(`    confidence > 35:        ${confGt35.cnt}`);
console.log(`    confidence <= 50:       ${confLe50.cnt}`);
console.log(`    35 < confidence <= 50:  ${confBand.cnt}`);
console.log(`    ALL THREE combined:     ${matchingCount.cnt}`);

// Also check: what if we loosen score to >15 or >20?
const score15 = db.prepare("SELECT COUNT(*) as cnt FROM training_rounds WHERE ABS(final_score) > 15 AND confidence > 35 AND confidence <= 50 AND polymarket_up_price > 0.01").get();
const score20 = db.prepare("SELECT COUNT(*) as cnt FROM training_rounds WHERE ABS(final_score) > 20 AND confidence > 35 AND confidence <= 50 AND polymarket_up_price > 0.01").get();
console.log(`\n  Loosening score threshold (keeping 35<conf<=50):`);
console.log(`    |score| > 15: ${score15.cnt} rounds`);
console.log(`    |score| > 20: ${score20.cnt} rounds`);
console.log(`    |score| > 25: ${matchingCount.cnt} rounds (current)\n`);

// 4. What if we widen the confidence band?
console.log('--- 4. WIDENING CONFIDENCE BAND ---');
const confBands = [
  { label: '25 < conf <= 50', where: 'confidence > 25 AND confidence <= 50' },
  { label: '30 < conf <= 50', where: 'confidence > 30 AND confidence <= 50' },
  { label: '35 < conf <= 50', where: 'confidence > 35 AND confidence <= 50' },
  { label: '35 < conf <= 60', where: 'confidence > 35 AND confidence <= 60' },
  { label: '30 < conf <= 60', where: 'confidence > 30 AND confidence <= 60' },
  { label: '25 < conf <= 60', where: 'confidence > 25 AND confidence <= 60' },
  { label: 'conf > 35 (no cap)', where: 'confidence > 35' },
  { label: 'conf > 25 (no cap)', where: 'confidence > 25' },
];
for (const b of confBands) {
  const r = db.prepare(`SELECT COUNT(*) as cnt FROM training_rounds WHERE ABS(final_score) > 25 AND ${b.where} AND polymarket_up_price > 0.01`).get();
  console.log(`  |score|>25, ${b.label}: ${r.cnt} rounds`);
}

// 5. Confidence distribution
console.log('\n--- 5. CONFIDENCE DISTRIBUTION ---');
const confDist = db.prepare(`
  SELECT
    CASE
      WHEN confidence <= 10 THEN '0-10'
      WHEN confidence <= 20 THEN '11-20'
      WHEN confidence <= 30 THEN '21-30'
      WHEN confidence <= 35 THEN '31-35'
      WHEN confidence <= 40 THEN '36-40'
      WHEN confidence <= 50 THEN '41-50'
      WHEN confidence <= 60 THEN '51-60'
      WHEN confidence <= 70 THEN '61-70'
      WHEN confidence <= 80 THEN '71-80'
      ELSE '81+'
    END as band,
    COUNT(*) as cnt
  FROM training_rounds
  WHERE polymarket_up_price > 0.01 AND final_score IS NOT NULL
  GROUP BY band
  ORDER BY MIN(confidence)
`).all();
for (const row of confDist) {
  console.log(`  conf ${row.band}: ${row.cnt} rounds`);
}

// 6. Score distribution
console.log('\n--- 6. SCORE DISTRIBUTION ---');
const scoreDist = db.prepare(`
  SELECT
    CASE
      WHEN ABS(final_score) <= 5 THEN '0-5'
      WHEN ABS(final_score) <= 10 THEN '6-10'
      WHEN ABS(final_score) <= 15 THEN '11-15'
      WHEN ABS(final_score) <= 20 THEN '16-20'
      WHEN ABS(final_score) <= 25 THEN '21-25'
      WHEN ABS(final_score) <= 30 THEN '26-30'
      WHEN ABS(final_score) <= 40 THEN '31-40'
      WHEN ABS(final_score) <= 50 THEN '41-50'
      ELSE '51+'
    END as band,
    COUNT(*) as cnt
  FROM training_rounds
  WHERE polymarket_up_price > 0.01 AND final_score IS NOT NULL
  GROUP BY band
  ORDER BY MIN(ABS(final_score))
`).all();
for (const row of scoreDist) {
  console.log(`  |score| ${row.band}: ${row.cnt} rounds`);
}

// 7. EV filter impact — how many of the matching rounds also pass EV>0?
console.log('\n--- 7. EV FILTER IMPACT ON QUALIFYING ROUNDS ---');
const qualifyingRounds = db.prepare(`
  SELECT final_score, confidence, polymarket_up_price, polymarket_down_price, actual_result
  FROM training_rounds
  WHERE ABS(final_score) > 25 AND confidence > 35 AND confidence <= 50 AND polymarket_up_price > 0.01
`).all();

let evPassCount = 0;
let evFailCount = 0;
const feeRate = 0.02; // typical fee
for (const r of qualifyingRounds) {
  const absScore = Math.abs(r.final_score);
  const dir = r.final_score > 0 ? 'UP' : 'DOWN';
  const price = dir === 'UP' ? r.polymarket_up_price : r.polymarket_down_price;
  if (!price || price < 0.05) { evFailCount++; continue; }
  const prob = Math.min(0.85, 0.5 + absScore / 200);
  const ev = (prob * (1 - price)) - ((1 - prob) * price) - feeRate;
  if (ev > 0) evPassCount++;
  else evFailCount++;
}
console.log(`  Qualifying rounds: ${qualifyingRounds.length}`);
console.log(`  Pass EV>0 check: ${evPassCount}`);
console.log(`  Fail EV check: ${evFailCount}`);

// 8. Win rate analysis of qualifying rounds
console.log('\n--- 8. WIN RATE OF QUALIFYING ROUNDS ---');
let qualWins = 0, qualLosses = 0;
for (const r of qualifyingRounds) {
  const dir = r.final_score > 0 ? 'UP' : 'DOWN';
  if (dir === r.actual_result) qualWins++;
  else qualLosses++;
}
console.log(`  Wins: ${qualWins}, Losses: ${qualLosses}`);
console.log(`  Win rate: ${qualifyingRounds.length > 0 ? (qualWins / qualifyingRounds.length * 100).toFixed(1) : 'N/A'}%`);

// 9. Compare with loosened criteria
console.log('\n--- 9. WIN RATE AT DIFFERENT THRESHOLDS ---');
const thresholds = [
  { label: '|s|>15, c>25, c<=60', where: 'ABS(final_score) > 15 AND confidence > 25 AND confidence <= 60' },
  { label: '|s|>20, c>30, c<=55', where: 'ABS(final_score) > 20 AND confidence > 30 AND confidence <= 55' },
  { label: '|s|>20, c>30, no cap', where: 'ABS(final_score) > 20 AND confidence > 30' },
  { label: '|s|>25, c>35, no cap', where: 'ABS(final_score) > 25 AND confidence > 35' },
  { label: '|s|>25, c>35, c<=50', where: 'ABS(final_score) > 25 AND confidence > 35 AND confidence <= 50' },
  { label: '|s|>15, c>25, no cap', where: 'ABS(final_score) > 15 AND confidence > 25' },
];
for (const t of thresholds) {
  const rows = db.prepare(`SELECT final_score, actual_result FROM training_rounds WHERE ${t.where} AND polymarket_up_price > 0.01`).all();
  let w = 0;
  for (const r of rows) {
    const dir = r.final_score > 0 ? 'UP' : 'DOWN';
    if (dir === r.actual_result) w++;
  }
  const wr = rows.length > 0 ? (w / rows.length * 100).toFixed(1) : 'N/A';
  console.log(`  ${t.label.padEnd(30)} → ${rows.length} rounds, ${w} wins, WR=${wr}%`);
}

// 10. Trailing stop analysis
console.log('\n--- 10. TRAILING STOP ANALYSIS ---');
const selectiveTrades = db.prepare("SELECT * FROM strategy_trades WHERE strategy_name = 'SELECTIVE'").all();
const trailingExits = selectiveTrades.filter(t => t.exit_reason === 'trailing_stop_20pct');
const heldToExpiry = selectiveTrades.filter(t => t.exit_reason === 'held_to_expiry');
console.log(`  Total SELECTIVE trades: ${selectiveTrades.length}`);
console.log(`  Trailing stop exits: ${trailingExits.length}`);
console.log(`  Held to expiry: ${heldToExpiry.length}`);

if (trailingExits.length > 0) {
  const avgPnl = trailingExits.reduce((s, t) => s + t.pnl, 0) / trailingExits.length;
  console.log(`  Avg PnL on trailing exits: $${avgPnl.toFixed(4)}`);
}
if (heldToExpiry.length > 0) {
  const avgPnl = heldToExpiry.reduce((s, t) => s + t.pnl, 0) / heldToExpiry.length;
  console.log(`  Avg PnL on held-to-expiry: $${avgPnl.toFixed(4)}`);
}

// 11. SELECTIVE balance
console.log('\n--- 11. SELECTIVE STRATEGY BALANCE ---');
const balance = db.prepare("SELECT * FROM strategy_balances WHERE strategy_name = 'SELECTIVE'").get();
if (balance) {
  console.log(`  Balance: $${balance.balance}`);
  console.log(`  Total PnL: $${balance.total_pnl}`);
  console.log(`  Wins/Losses: ${balance.wins}/${balance.losses}`);
  console.log(`  Win Rate: ${balance.total_trades > 0 ? (balance.wins / balance.total_trades * 100).toFixed(1) : 'N/A'}%`);
  console.log(`  Max Drawdown: ${(balance.max_drawdown * 100).toFixed(1)}%`);
} else {
  console.log('  No balance record found (strategy never initialized).');
}

// 12. Compare with other strategies
console.log('\n--- 12. ALL STRATEGY COMPARISON ---');
const allStrats = db.prepare("SELECT * FROM strategy_balances ORDER BY total_pnl DESC").all();
for (const s of allStrats) {
  const wr = s.total_trades > 0 ? (s.wins / s.total_trades * 100).toFixed(1) : 'N/A';
  console.log(`  ${s.strategy_name.padEnd(20)} Bal=$${String(s.balance).padEnd(8)} PnL=$${String(s.total_pnl).padEnd(8)} Trades=${String(s.total_trades).padEnd(4)} WR=${wr}% DD=${(s.max_drawdown * 100).toFixed(1)}%`);
}

// 13. How many rounds COULD have been entered (total qualifying minus actual entries)?
console.log('\n--- 13. MISSED OPPORTUNITIES ---');
const actualEntries = selectiveTrades.length;
const couldHaveEntered = evPassCount; // rounds that pass score+conf+ev
console.log(`  Rounds passing ALL filters (score, conf, EV): ${couldHaveEntered}`);
console.log(`  Actual trades taken: ${actualEntries}`);
console.log(`  Missed (could have entered but didn't): ${Math.max(0, couldHaveEntered - actualEntries)}`);
console.log(`  Note: "missed" could be due to timing, price at evaluation time, or other runtime factors.\n`);

db.close();

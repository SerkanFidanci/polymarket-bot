const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'data', 'trading.db'));

console.log('===== SELECTIVE DEEP DIVE =====\n');

// The single trade details
console.log('--- SINGLE TRADE (round 433) ---');
const trade = db.prepare("SELECT * FROM strategy_trades WHERE strategy_name = 'SELECTIVE' AND round_id = 433").get();
console.log(JSON.stringify(trade, null, 2));

const round = db.prepare("SELECT * FROM training_rounds WHERE id = 433").get();
if (round) {
  console.log('\nRound 433 details:');
  console.log(`  final_score: ${round.final_score}`);
  console.log(`  confidence: ${round.confidence}`);
  console.log(`  actual_result: ${round.actual_result}`);
  console.log(`  polymarket_up_price: ${round.polymarket_up_price}`);
  console.log(`  polymarket_down_price: ${round.polymarket_down_price}`);
}

// The trade entered DOWN at 22.5c, trailing stopped at 16.5c
// But actual result was DOWN -- so it would have WON if held to expiry
console.log('\n--- TRAILING STOP DAMAGE ANALYSIS ---');
console.log('Trade entered BUY_DOWN at 22.5c, exited at 16.5c via trailing stop.');
console.log('Actual result was DOWN. If held to expiry, payout = $1.00 per share.');
const shares = trade.bet_size / trade.entry_price;
const hypotheticalPnl = (1.0 - trade.entry_price) * shares;
console.log(`  Shares bought: ${shares.toFixed(4)}`);
console.log(`  Actual PnL (trailing stop): $${trade.pnl.toFixed(4)}`);
console.log(`  Hypothetical PnL (held to expiry): $${hypotheticalPnl.toFixed(4)}`);
console.log(`  PnL LOST to trailing stop: $${(hypotheticalPnl - trade.pnl).toFixed(4)}`);

// Analyze trailing stops across ALL strategies
console.log('\n--- TRAILING STOP ACROSS ALL STRATEGIES ---');
const allTrailing = db.prepare("SELECT * FROM strategy_trades WHERE exit_reason LIKE 'trailing_stop%'").all();
console.log(`Total trailing stop exits: ${allTrailing.length}`);
let trailingWouldHaveWon = 0;
let trailingTotalLostPnl = 0;
for (const t of allTrailing) {
  const dir = t.decision === 'BUY_UP' ? 'UP' : 'DOWN';
  const wouldWin = dir === t.actual_result;
  if (wouldWin) {
    trailingWouldHaveWon++;
    const shares = t.bet_size / t.entry_price;
    const hypothetical = (1.0 - t.entry_price) * shares;
    trailingTotalLostPnl += (hypothetical - t.pnl);
    console.log(`  ${t.strategy_name} round=${t.round_id}: stopped at ${t.exit_price}, result=${t.actual_result}, WOULD HAVE WON. Lost PnL: $${(hypothetical - t.pnl).toFixed(4)}`);
  } else {
    console.log(`  ${t.strategy_name} round=${t.round_id}: stopped at ${t.exit_price}, result=${t.actual_result}, correctly stopped (would have lost)`);
  }
}
console.log(`\nTrailing stops that WOULD HAVE WON if held: ${trailingWouldHaveWon}/${allTrailing.length}`);
console.log(`Total PnL lost to premature stops: $${trailingTotalLostPnl.toFixed(4)}`);

// Look at the 5 qualifying rounds in detail
console.log('\n--- ALL 5 QUALIFYING ROUNDS (|score|>25, 35<conf<=50, price>0.01) ---');
const qualifying = db.prepare(`
  SELECT id, final_score, confidence, polymarket_up_price, polymarket_down_price, actual_result, created_at
  FROM training_rounds
  WHERE ABS(final_score) > 25 AND confidence > 35 AND confidence <= 50 AND polymarket_up_price > 0.01
  ORDER BY id ASC
`).all();
for (const r of qualifying) {
  const dir = r.final_score > 0 ? 'UP' : 'DOWN';
  const correct = dir === r.actual_result ? 'CORRECT' : 'WRONG';
  const price = dir === 'UP' ? r.polymarket_up_price : r.polymarket_down_price;

  // EV check
  const absScore = Math.abs(r.final_score);
  const prob = Math.min(0.85, 0.5 + absScore / 200);
  const ev = (prob * (1 - price)) - ((1 - prob) * price) - 0.02;

  console.log(`  Round ${r.id}: score=${r.final_score.toFixed(1)}, conf=${r.confidence.toFixed(1)}, dir=${dir}, price=${price?.toFixed(3) || 'N/A'}, result=${r.actual_result}, ${correct}, EV=${ev.toFixed(4)}, created=${r.created_at}`);
}

// The sweet spot: |s|>20, c>30, c<=55 with 70% WR
console.log('\n--- BEST THRESHOLD: |s|>20, c>30, c<=55 (70% WR) ---');
const bestRows = db.prepare(`
  SELECT id, final_score, confidence, polymarket_up_price, polymarket_down_price, actual_result
  FROM training_rounds
  WHERE ABS(final_score) > 20 AND confidence > 30 AND confidence <= 55 AND polymarket_up_price > 0.01
  ORDER BY id ASC
`).all();
let bWins = 0, bLosses = 0;
let bTotalPnl = 0;
for (const r of bestRows) {
  const dir = r.final_score > 0 ? 'UP' : 'DOWN';
  const correct = dir === r.actual_result;
  const price = dir === 'UP' ? r.polymarket_up_price : r.polymarket_down_price;
  if (correct) { bWins++; } else { bLosses++; }

  // Simulate PnL (5% of $50 = $2.50 bet, held to expiry)
  if (price && price > 0.05) {
    const betSize = 2.50;
    const shares = betSize / price;
    const pnl = correct ? (1.0 - price) * shares : -betSize;
    bTotalPnl += pnl;
  }
}
console.log(`  Rounds: ${bestRows.length}, Wins: ${bWins}, Losses: ${bLosses}, WR: ${(bWins/bestRows.length*100).toFixed(1)}%`);
console.log(`  Simulated total PnL (flat $2.50 bet, held to expiry): $${bTotalPnl.toFixed(2)}`);

// What about no confidence cap at all?
console.log('\n--- REMOVING CONFIDENCE CAP (conf<=50) ---');
const noCap = db.prepare(`
  SELECT id, final_score, confidence, polymarket_up_price, polymarket_down_price, actual_result
  FROM training_rounds
  WHERE ABS(final_score) > 25 AND confidence > 35 AND polymarket_up_price > 0.01
  ORDER BY id ASC
`).all();
let ncWins = 0;
for (const r of noCap) {
  const dir = r.final_score > 0 ? 'UP' : 'DOWN';
  if (dir === r.actual_result) ncWins++;
  const correct = dir === r.actual_result ? 'CORRECT' : 'WRONG';
  console.log(`  Round ${r.id}: score=${r.final_score.toFixed(1)}, conf=${r.confidence.toFixed(1)}, result=${r.actual_result}, ${correct}`);
}
console.log(`  No cap: ${noCap.length} rounds, ${ncWins} wins, WR=${(ncWins/noCap.length*100).toFixed(1)}%`);

// Max confidence in the dataset
console.log('\n--- CONFIDENCE EXTREMES ---');
const maxConf = db.prepare("SELECT MAX(confidence) as mx FROM training_rounds WHERE polymarket_up_price > 0.01").get();
const avgConf = db.prepare("SELECT AVG(confidence) as avg FROM training_rounds WHERE polymarket_up_price > 0.01 AND confidence IS NOT NULL").get();
const p90Conf = db.prepare("SELECT confidence FROM training_rounds WHERE polymarket_up_price > 0.01 AND confidence IS NOT NULL ORDER BY confidence ASC").all();
const idx90 = Math.floor(p90Conf.length * 0.9);
const idx95 = Math.floor(p90Conf.length * 0.95);
console.log(`  Max confidence: ${maxConf.mx}`);
console.log(`  Avg confidence: ${avgConf.avg?.toFixed(1)}`);
console.log(`  P90 confidence: ${p90Conf[idx90]?.confidence}`);
console.log(`  P95 confidence: ${p90Conf[idx95]?.confidence}`);

// Max score
const maxScore = db.prepare("SELECT MAX(ABS(final_score)) as mx FROM training_rounds WHERE polymarket_up_price > 0.01").get();
const avgScore = db.prepare("SELECT AVG(ABS(final_score)) as avg FROM training_rounds WHERE polymarket_up_price > 0.01 AND final_score IS NOT NULL").get();
console.log(`  Max |score|: ${maxScore.mx}`);
console.log(`  Avg |score|: ${avgScore.avg?.toFixed(1)}`);

db.close();

/**
 * fix-weights.cjs
 *
 * Emergency weight fix: penalize signals with accuracy below random (50%).
 *
 * Latest accuracy data (497 rounds, 2026-04-07 18:19:15):
 *   orderbook:     51.90%  (keep)
 *   ema_macd:      59.43%  (above 55% — receives redistribution)
 *   rsi_stoch:     49.85%  (below 50% — penalize to 0.03)
 *   vwap_bb:       43.75%  (below 48% — penalize to 0.02)
 *   cvd:           52.26%  (keep)
 *   whale:         50.37%  (keep)
 *   funding:       47.60%  (below 48% — penalize to 0.02)
 *   open_interest: 57.63%  (above 55% — receives redistribution)
 *   liquidation:   77.27%  (above 55% but 95.6% abstain rate — keep at 0)
 *   ls_ratio:      49.85%  (below 50% — penalize to 0.03)
 */

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'data', 'trading.db'));

// ── 1. Read current weights ──────────────────────────────────────────────────
const currentRow = db.prepare(
  'SELECT id, new_weights, timestamp FROM optimization_history WHERE applied = 1 ORDER BY id DESC LIMIT 1'
).get();

const oldWeights = JSON.parse(currentRow.new_weights);
console.log('Current weights (optimization_history id=%d, %s):', currentRow.id, currentRow.timestamp);
console.log(JSON.stringify(oldWeights, null, 2));
console.log();

// ── 2. Signal accuracy from latest log ───────────────────────────────────────
const accuracy = {
  orderbook:     0.5190,
  ema_macd:      0.5943,
  rsi_stoch:     0.4985,
  vwap_bb:       0.4375,
  cvd:           0.5226,
  whale:         0.5037,
  funding:       0.4760,
  open_interest: 0.5763,
  liquidation:   0.7727,  // 95.6% abstain — keep at 0
  ls_ratio:      0.4985,
};

// ── 3. Calculate new weights ─────────────────────────────────────────────────
// Rules:
//   accuracy < 0.48  → 0.02 (minimal, keep data flowing)
//   accuracy < 0.50  → 0.03
//   liquidation      → 0    (too high abstain rate)
//   accuracy >= 0.55 → receives proportional redistribution of freed weight
//   others           → keep current weight, then normalize

const newWeights = {};

// Step A: assign penalized weights
const penalizedSignals = [];
const recipientSignals = [];  // accuracy > 55%
const neutralSignals = [];     // 50-55%, keep current

for (const [signal, acc] of Object.entries(accuracy)) {
  if (signal === 'liquidation') {
    newWeights[signal] = 0;
  } else if (acc < 0.48) {
    newWeights[signal] = 0.02;
    penalizedSignals.push(signal);
  } else if (acc < 0.50) {
    newWeights[signal] = 0.03;
    penalizedSignals.push(signal);
  } else if (acc >= 0.55) {
    recipientSignals.push(signal);
  } else {
    neutralSignals.push(signal);
  }
}

console.log('Penalized signals (<50% accuracy):', penalizedSignals);
console.log('Recipient signals (>55% accuracy):', recipientSignals);
console.log('Neutral signals (50-55%):', neutralSignals);
console.log();

// Step B: sum what's been assigned so far (penalized + liquidation)
let assignedWeight = 0;
for (const [signal, w] of Object.entries(newWeights)) {
  assignedWeight += w;
}

// Step C: keep neutral signals at their current weight (raw, pre-normalization)
let neutralTotal = 0;
for (const signal of neutralSignals) {
  newWeights[signal] = oldWeights[signal];
  neutralTotal += oldWeights[signal];
}

// Step D: the remaining weight goes to recipient signals, distributed proportionally
//         by their current weight
const remainingForRecipients = 1.0 - assignedWeight - neutralTotal;
const recipientOldTotal = recipientSignals.reduce((sum, s) => sum + oldWeights[s], 0);

for (const signal of recipientSignals) {
  const proportion = oldWeights[signal] / recipientOldTotal;
  newWeights[signal] = remainingForRecipients * proportion;
}

// Step E: verify total = 1.0 (floating point cleanup)
let total = Object.values(newWeights).reduce((a, b) => a + b, 0);
console.log('Pre-normalization total:', total.toFixed(10));

// Micro-adjust the largest recipient to force total to exactly 1.0
if (Math.abs(total - 1.0) > 1e-10) {
  const largestRecipient = recipientSignals.reduce((a, b) =>
    newWeights[a] > newWeights[b] ? a : b
  );
  newWeights[largestRecipient] += (1.0 - total);
}

total = Object.values(newWeights).reduce((a, b) => a + b, 0);
console.log('Post-normalization total:', total.toFixed(10));
console.log();

// ── 4. Print comparison ──────────────────────────────────────────────────────
console.log('Signal            Old Weight   New Weight   Accuracy   Change');
console.log('─'.repeat(70));
const signals = Object.keys(accuracy);
for (const s of signals) {
  const oldW = oldWeights[s] || 0;
  const newW = newWeights[s] || 0;
  const acc = (accuracy[s] * 100).toFixed(1);
  const delta = ((newW - oldW) * 100).toFixed(2);
  const sign = newW > oldW ? '+' : '';
  console.log(
    `${s.padEnd(18)} ${(oldW * 100).toFixed(2).padStart(8)}%  ${(newW * 100).toFixed(2).padStart(8)}%  ${acc.padStart(7)}%  ${sign}${delta}pp`
  );
}
console.log();

// ── 5. Insert into optimization_history ──────────────────────────────────────
const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

const insertStmt = db.prepare(`
  INSERT INTO optimization_history (
    timestamp, optimization_type, rounds_analyzed,
    old_weights, new_weights,
    old_thresholds, new_thresholds,
    old_simulated_pnl, new_simulated_pnl,
    improvement_percent, applied, reason
  ) VALUES (
    @timestamp, @optimization_type, @rounds_analyzed,
    @old_weights, @new_weights,
    @old_thresholds, @new_thresholds,
    @old_simulated_pnl, @new_simulated_pnl,
    @improvement_percent, @applied, @reason
  )
`);

const result = insertStmt.run({
  timestamp: now,
  optimization_type: 'manual_penalty',
  rounds_analyzed: 497,
  old_weights: JSON.stringify(oldWeights),
  new_weights: JSON.stringify(newWeights),
  old_thresholds: null,
  new_thresholds: null,
  old_simulated_pnl: null,
  new_simulated_pnl: null,
  improvement_percent: null,
  applied: 1,
  reason: 'Manual fix: penalize signals with accuracy below 50% (vwap_bb 43.8%, funding 47.6%, ls_ratio 49.9%, rsi_stoch 49.9%). Redistribute freed weight to ema_macd (59.4%) and open_interest (57.6%).'
});

console.log('Inserted optimization_history row id=%d with applied=1', result.lastInsertRowid);
console.log();

// ── 6. Verify ────────────────────────────────────────────────────────────────
const verifyRow = db.prepare(
  'SELECT id, new_weights FROM optimization_history WHERE applied = 1 ORDER BY id DESC LIMIT 1'
).get();
const verified = JSON.parse(verifyRow.new_weights);
console.log('Verification — latest applied weights (id=%d):', verifyRow.id);
console.log(JSON.stringify(verified, null, 2));
console.log();
console.log('Done. Restart the server (pm2 restart all) to pick up new weights.');

db.close();

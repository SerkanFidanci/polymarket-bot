const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '..', 'data', 'trading.db'));

// ============================================================
// DEEP PATTERN ANALYSIS: WHAT DISTINGUISHES WINNERS FROM LOSERS
// ============================================================

// Baseline filter: hypothetical_decision != 'SKIP' AND polymarket_up_price > 0.01
const allTrades = db.prepare(`
  SELECT * FROM training_rounds
  WHERE hypothetical_decision != 'SKIP'
    AND polymarket_up_price > 0.01
  ORDER BY id ASC
`).all();

// Classify wins and losses
function getDirection(t) {
  return t.hypothetical_decision === 'BUY_UP' ? 'UP' : 'DOWN';
}
function isWin(t) {
  return getDirection(t) === t.actual_result;
}
function entryPrice(t) {
  return t.hypothetical_decision === 'BUY_UP' ? t.polymarket_up_price : t.polymarket_down_price;
}

const wins = allTrades.filter(isWin);
const losses = allTrades.filter(t => !isWin(t));

function avg(arr) { return arr.length === 0 ? 0 : arr.reduce((a,b) => a+b, 0) / arr.length; }
function median(arr) {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a,b) => a-b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid-1] + s[mid]) / 2;
}
function pad(s, n) { return String(s).padStart(n); }
function pct(n, d) { return d === 0 ? '  N/A' : (n/d*100).toFixed(1) + '%'; }

console.log('================================================================');
console.log('  DEEP PATTERN ANALYSIS: WINNERS vs LOSERS');
console.log('================================================================');
console.log(`  Total valid trades: ${allTrades.length}`);
console.log(`  WINS: ${wins.length} (${pct(wins.length, allTrades.length)})`);
console.log(`  LOSSES: ${losses.length} (${pct(losses.length, allTrades.length)})`);
console.log('================================================================\n');

// ============================================================
// SECTION 1: AGGREGATE METRICS - WINS vs LOSSES
// ============================================================
console.log('=== SECTION 1: AGGREGATE METRICS — WINS vs LOSSES ===\n');

const metrics = [
  { name: '|final_score|', fn: t => Math.abs(t.final_score || 0) },
  { name: 'confidence', fn: t => t.confidence || 0 },
  { name: 'entry_price', fn: t => entryPrice(t) || 0 },
  { name: 'bet_size', fn: t => t.hypothetical_bet_size || 0 },
  { name: 'EV', fn: t => t.hypothetical_ev || 0 },
  { name: '|PnL|', fn: t => Math.abs(t.hypothetical_pnl || 0) },
  { name: 'volatility_1m', fn: t => t.market_volatility_1m || 0 },
  { name: 'volatility_5m', fn: t => t.market_volatility_5m || 0 },
  { name: 'orderbook_spread', fn: t => t.orderbook_spread || 0 },
  { name: 'avg_trade_vol_1m', fn: t => t.avg_trade_volume_1m || 0 },
  { name: 'whale_count_2m', fn: t => t.whale_count_2m || 0 },
];

console.log('Metric              |   WINS avg  |  LOSSES avg |  DIFF (W-L)  | W median | L median');
console.log('--------------------|-------------|-------------|--------------|----------|----------');
for (const m of metrics) {
  const wAvg = avg(wins.map(m.fn));
  const lAvg = avg(losses.map(m.fn));
  const diff = wAvg - lAvg;
  const wMed = median(wins.map(m.fn));
  const lMed = median(losses.map(m.fn));
  console.log(
    m.name.padEnd(20) + '| ' +
    wAvg.toFixed(4).padStart(11) + ' | ' +
    lAvg.toFixed(4).padStart(11) + ' | ' +
    (diff >= 0 ? '+' : '') + diff.toFixed(4).padStart(11) + '  | ' +
    wMed.toFixed(4).padStart(8) + ' | ' +
    lMed.toFixed(4).padStart(8)
  );
}
console.log('');

// ============================================================
// SECTION 2: SIGNAL-BY-SIGNAL ANALYSIS — WINS vs LOSSES
// ============================================================
console.log('=== SECTION 2: SIGNAL-BY-SIGNAL — WINS vs LOSSES ===\n');

const signals = [
  'orderbook', 'ema_macd', 'rsi_stoch', 'vwap_bb', 'cvd',
  'whale', 'funding', 'open_interest', 'ls_ratio', 'liquidation'
];

console.log('Signal          |  W avg  |  L avg  |  DIFF   | W>L? | |W avg| | |L avg| | |DIFF|');
console.log('----------------|---------|---------|---------|------|---------|---------|---------');

const signalDiffs = [];

for (const sig of signals) {
  const col = 'signal_' + sig;
  const wVals = wins.map(t => t[col] || 0);
  const lVals = losses.map(t => t[col] || 0);
  const wAvg = avg(wVals);
  const lAvg = avg(lVals);
  const diff = wAvg - lAvg;
  const wAbsAvg = avg(wVals.map(Math.abs));
  const lAbsAvg = avg(lVals.map(Math.abs));
  const absDiff = wAbsAvg - lAbsAvg;

  signalDiffs.push({ sig, diff: Math.abs(diff), absDiff: Math.abs(absDiff), wAvg, lAvg });

  console.log(
    sig.padEnd(16) + '| ' +
    wAvg.toFixed(3).padStart(7) + ' | ' +
    lAvg.toFixed(3).padStart(7) + ' | ' +
    (diff >= 0 ? '+' : '') + diff.toFixed(3).padStart(6) + '  | ' +
    (diff > 0 ? ' YES ' : '  no ') + '| ' +
    wAbsAvg.toFixed(3).padStart(7) + ' | ' +
    lAbsAvg.toFixed(3).padStart(7) + ' | ' +
    (absDiff >= 0 ? '+' : '') + absDiff.toFixed(3).padStart(6)
  );
}

console.log('\n--- SIGNALS RANKED BY RAW DIFFERENCE (most predictive first) ---');
signalDiffs.sort((a,b) => b.diff - a.diff);
signalDiffs.forEach((s, i) => {
  console.log(`  ${i+1}. ${s.sig.padEnd(16)} |diff|=${s.diff.toFixed(4)}  W_avg=${s.wAvg.toFixed(3)}  L_avg=${s.lAvg.toFixed(3)}`);
});

console.log('\n--- SIGNALS RANKED BY |ABSOLUTE| DIFFERENCE ---');
const absSorted = [...signalDiffs].sort((a,b) => Math.abs(b.absDiff) - Math.abs(a.absDiff));
absSorted.forEach((s, i) => {
  console.log(`  ${i+1}. ${s.sig.padEnd(16)} |abs diff|=${Math.abs(s.absDiff).toFixed(4)}`);
});

// Also: sign agreement analysis
console.log('\n--- SIGN AGREEMENT: Does signal direction match trade direction? ---');
for (const sig of signals) {
  const col = 'signal_' + sig;
  let wAgree = 0, wTotal = 0, lAgree = 0, lTotal = 0;
  for (const t of wins) {
    const v = t[col] || 0;
    if (v === 0) continue;
    wTotal++;
    const tradeDir = t.hypothetical_decision === 'BUY_UP' ? 1 : -1;
    if (Math.sign(v) === tradeDir) wAgree++;
  }
  for (const t of losses) {
    const v = t[col] || 0;
    if (v === 0) continue;
    lTotal++;
    const tradeDir = t.hypothetical_decision === 'BUY_UP' ? 1 : -1;
    if (Math.sign(v) === tradeDir) lAgree++;
  }
  console.log(
    `  ${sig.padEnd(16)} WIN sign-agree: ${pct(wAgree, wTotal).padStart(6)} (${wAgree}/${wTotal})` +
    `  |  LOSS sign-agree: ${pct(lAgree, lTotal).padStart(6)} (${lAgree}/${lTotal})`
  );
}
console.log('');

// ============================================================
// SECTION 3: ENTRY PRICE ANALYSIS
// ============================================================
console.log('=== SECTION 3: ENTRY PRICE ANALYSIS ===\n');

const priceBands = [
  { label: '< 0.30 (cheap)',    min: 0, max: 0.30 },
  { label: '0.30 - 0.50',       min: 0.30, max: 0.50 },
  { label: '0.50 - 0.70',       min: 0.50, max: 0.70 },
  { label: '> 0.70 (expensive)', min: 0.70, max: 1.01 },
];

console.log('Price Band          | Trades | Wins | Losses | Win Rate | Avg PnL   | Total PnL');
console.log('--------------------|--------|------|--------|----------|-----------|----------');

for (const band of priceBands) {
  const subset = allTrades.filter(t => {
    const p = entryPrice(t);
    return p != null && p >= band.min && p < band.max;
  });
  const w = subset.filter(isWin);
  const l = subset.filter(t => !isWin(t));
  const totalPnl = subset.reduce((s, t) => s + (t.hypothetical_pnl || 0), 0);
  const avgPnl = subset.length > 0 ? totalPnl / subset.length : 0;

  console.log(
    band.label.padEnd(20) + '| ' +
    String(subset.length).padStart(6) + ' | ' +
    String(w.length).padStart(4) + ' | ' +
    String(l.length).padStart(6) + ' | ' +
    pct(w.length, subset.length).padStart(8) + ' | ' +
    (avgPnl >= 0 ? '+' : '') + avgPnl.toFixed(4).padStart(8) + '  | ' +
    (totalPnl >= 0 ? '+' : '') + totalPnl.toFixed(2).padStart(8)
  );
}

// Finer granularity
console.log('\n--- Fine-grained price bins (5c increments) ---');
console.log('Bin         | Trades | WR     | Avg PnL');
console.log('------------|--------|--------|--------');
for (let low = 0.05; low < 1.0; low += 0.05) {
  const high = low + 0.05;
  const subset = allTrades.filter(t => {
    const p = entryPrice(t);
    return p != null && p >= low && p < high;
  });
  if (subset.length === 0) continue;
  const w = subset.filter(isWin).length;
  const avgPnl = avg(subset.map(t => t.hypothetical_pnl || 0));
  console.log(
    `${(low*100).toFixed(0).padStart(3)}c-${(high*100).toFixed(0).padStart(3)}c    | ` +
    String(subset.length).padStart(6) + ' | ' +
    pct(w, subset.length).padStart(6) + ' | ' +
    (avgPnl >= 0 ? '+' : '') + avgPnl.toFixed(4)
  );
}
console.log('');

// ============================================================
// SECTION 4: TIME ANALYSIS (HOUR OF DAY, UTC)
// ============================================================
console.log('=== SECTION 4: TIME ANALYSIS — HOUR OF DAY (UTC) ===\n');

console.log('Hour (UTC) | Trades | Wins | Losses | Win Rate | Avg PnL   | Tot PnL');
console.log('-----------|--------|------|--------|----------|-----------|--------');

const hourStats = {};
for (let h = 0; h < 24; h++) hourStats[h] = { trades: 0, wins: 0, pnl: 0 };

for (const t of allTrades) {
  if (!t.round_start_time) continue;
  const hour = parseInt(t.round_start_time.slice(11, 13));
  if (isNaN(hour)) continue;
  hourStats[hour].trades++;
  if (isWin(t)) hourStats[hour].wins++;
  hourStats[hour].pnl += (t.hypothetical_pnl || 0);
}

for (let h = 0; h < 24; h++) {
  const s = hourStats[h];
  if (s.trades === 0) continue;
  const losses = s.trades - s.wins;
  const avgPnl = s.pnl / s.trades;
  console.log(
    `    ${String(h).padStart(2)}:00  | ` +
    String(s.trades).padStart(6) + ' | ' +
    String(s.wins).padStart(4) + ' | ' +
    String(losses).padStart(6) + ' | ' +
    pct(s.wins, s.trades).padStart(8) + ' | ' +
    (avgPnl >= 0 ? '+' : '') + avgPnl.toFixed(4).padStart(8) + '  | ' +
    (s.pnl >= 0 ? '+' : '') + s.pnl.toFixed(2).padStart(6)
  );
}

// Session groupings
console.log('\n--- Session groupings ---');
const sessions = [
  { label: 'Asia (00-08 UTC)',    hours: [0,1,2,3,4,5,6,7] },
  { label: 'Europe (08-16 UTC)',  hours: [8,9,10,11,12,13,14,15] },
  { label: 'US (16-24 UTC)',      hours: [16,17,18,19,20,21,22,23] },
];
for (const sess of sessions) {
  let trades = 0, w = 0, pnl = 0;
  for (const h of sess.hours) {
    trades += hourStats[h].trades;
    w += hourStats[h].wins;
    pnl += hourStats[h].pnl;
  }
  if (trades === 0) continue;
  console.log(`  ${sess.label.padEnd(22)} | ${String(trades).padStart(4)} trades | WR: ${pct(w, trades).padStart(6)} | PnL: ${(pnl >= 0 ? '+' : '') + pnl.toFixed(2)}`);
}
console.log('');

// ============================================================
// SECTION 5: CONSECUTIVE WIN/LOSS STREAKS
// ============================================================
console.log('=== SECTION 5: CONSECUTIVE STREAKS ===\n');

let currentStreak = 0;
let currentType = null; // 'W' or 'L'
const streaks = [];

for (const t of allTrades) {
  const w = isWin(t) ? 'W' : 'L';
  if (w === currentType) {
    currentStreak++;
  } else {
    if (currentType !== null) {
      streaks.push({ type: currentType, length: currentStreak });
    }
    currentType = w;
    currentStreak = 1;
  }
}
if (currentType !== null) {
  streaks.push({ type: currentType, length: currentStreak });
}

const winStreaks = streaks.filter(s => s.type === 'W').map(s => s.length);
const lossStreaks = streaks.filter(s => s.type === 'L').map(s => s.length);

console.log('Win Streaks:');
console.log(`  Count: ${winStreaks.length}`);
console.log(`  Max: ${winStreaks.length > 0 ? Math.max(...winStreaks) : 0}`);
console.log(`  Avg: ${avg(winStreaks).toFixed(2)}`);
console.log(`  Distribution:`);
const maxWS = winStreaks.length > 0 ? Math.max(...winStreaks) : 0;
for (let len = 1; len <= maxWS; len++) {
  const count = winStreaks.filter(s => s === len).length;
  if (count > 0) console.log(`    ${len}-streak: ${count} times`);
}

console.log('\nLoss Streaks:');
console.log(`  Count: ${lossStreaks.length}`);
console.log(`  Max: ${lossStreaks.length > 0 ? Math.max(...lossStreaks) : 0}`);
console.log(`  Avg: ${avg(lossStreaks).toFixed(2)}`);
console.log(`  Distribution:`);
const maxLS = lossStreaks.length > 0 ? Math.max(...lossStreaks) : 0;
for (let len = 1; len <= maxLS; len++) {
  const count = lossStreaks.filter(s => s === len).length;
  if (count > 0) console.log(`    ${len}-streak: ${count} times`);
}

// Clustering test: after a loss, is the next trade more likely to lose?
console.log('\n--- Clustering test: probability of next trade outcome ---');
let afterWin_win = 0, afterWin_total = 0;
let afterLoss_win = 0, afterLoss_total = 0;
for (let i = 1; i < allTrades.length; i++) {
  const prev = isWin(allTrades[i-1]);
  const curr = isWin(allTrades[i]);
  if (prev) {
    afterWin_total++;
    if (curr) afterWin_win++;
  } else {
    afterLoss_total++;
    if (curr) afterLoss_win++;
  }
}
console.log(`  After a WIN:  next WR = ${pct(afterWin_win, afterWin_total)} (${afterWin_win}/${afterWin_total})`);
console.log(`  After a LOSS: next WR = ${pct(afterLoss_win, afterLoss_total)} (${afterLoss_win}/${afterLoss_total})`);

// After 2+ consecutive losses?
let after2L_win = 0, after2L_total = 0;
for (let i = 2; i < allTrades.length; i++) {
  if (!isWin(allTrades[i-1]) && !isWin(allTrades[i-2])) {
    after2L_total++;
    if (isWin(allTrades[i])) after2L_win++;
  }
}
console.log(`  After 2+ LOSSES: next WR = ${pct(after2L_win, after2L_total)} (${after2L_win}/${after2L_total})`);

// Sequence visualization (first 100)
console.log('\n--- Sequence (W=win, L=loss, first 100 trades) ---');
let seq = '';
for (let i = 0; i < Math.min(100, allTrades.length); i++) {
  seq += isWin(allTrades[i]) ? 'W' : 'L';
  if ((i + 1) % 50 === 0) seq += '\n';
  else if ((i + 1) % 10 === 0) seq += ' ';
}
console.log('  ' + seq);
console.log('');

// ============================================================
// SECTION 6: DOWN vs UP — DETAILED BREAKDOWN
// ============================================================
console.log('=== SECTION 6: DOWN vs UP — FULL BREAKDOWN ===\n');

const buyUp = allTrades.filter(t => t.hypothetical_decision === 'BUY_UP');
const buyDown = allTrades.filter(t => t.hypothetical_decision === 'BUY_DOWN');

function fullBreakdown(subset, label) {
  const w = subset.filter(isWin);
  const l = subset.filter(t => !isWin(t));
  const totalPnl = subset.reduce((s, t) => s + (t.hypothetical_pnl || 0), 0);

  console.log(`--- ${label} ---`);
  console.log(`  Trades: ${subset.length} | Wins: ${w.length} | Losses: ${l.length} | WR: ${pct(w.length, subset.length)}`);
  console.log(`  Total PnL: ${(totalPnl >= 0 ? '+' : '')}${totalPnl.toFixed(2)} | Avg PnL: ${(totalPnl/subset.length).toFixed(4)}`);
  console.log(`  Avg |score|: ${avg(subset.map(t => Math.abs(t.final_score || 0))).toFixed(2)}`);
  console.log(`  Avg confidence: ${avg(subset.map(t => t.confidence || 0)).toFixed(2)}`);
  console.log(`  Avg entry_price: ${avg(subset.map(t => entryPrice(t) || 0)).toFixed(4)}`);
  console.log(`  Avg bet_size: ${avg(subset.map(t => t.hypothetical_bet_size || 0)).toFixed(4)}`);
  console.log(`  Avg EV: ${avg(subset.map(t => t.hypothetical_ev || 0)).toFixed(4)}`);
  console.log(`  Avg volatility_1m: ${avg(subset.map(t => t.market_volatility_1m || 0)).toFixed(6)}`);
  console.log(`  Avg volatility_5m: ${avg(subset.map(t => t.market_volatility_5m || 0)).toFixed(6)}`);

  console.log('  Signals:');
  for (const sig of signals) {
    const col = 'signal_' + sig;
    const wA = avg(w.map(t => t[col] || 0));
    const lA = avg(l.map(t => t[col] || 0));
    console.log(`    ${sig.padEnd(16)} WIN avg: ${wA.toFixed(3).padStart(7)} | LOSS avg: ${lA.toFixed(3).padStart(7)} | diff: ${(wA - lA >= 0 ? '+' : '')}${(wA - lA).toFixed(3)}`);
  }

  // Price distribution
  console.log('  Entry price distribution:');
  for (const band of priceBands) {
    const sub = subset.filter(t => {
      const p = entryPrice(t);
      return p != null && p >= band.min && p < band.max;
    });
    const sw = sub.filter(isWin).length;
    console.log(`    ${band.label.padEnd(22)} ${sub.length} trades | WR: ${pct(sw, sub.length)}`);
  }
  console.log('');
}

fullBreakdown(buyUp, 'BUY_UP');
fullBreakdown(buyDown, 'BUY_DOWN');

// Actual market result distribution
const totalRounds = db.prepare("SELECT COUNT(*) as c FROM training_rounds").get().c;
const actualUp = db.prepare("SELECT COUNT(*) as c FROM training_rounds WHERE actual_result = 'UP'").get().c;
const actualDown = db.prepare("SELECT COUNT(*) as c FROM training_rounds WHERE actual_result = 'DOWN'").get().c;
console.log(`Market actual distribution: UP=${actualUp} (${pct(actualUp, totalRounds)}) | DOWN=${actualDown} (${pct(actualDown, totalRounds)}) | Total=${totalRounds}`);
console.log('');

// ============================================================
// SECTION 7: MULTI-SIGNAL AGREEMENT ANALYSIS
// ============================================================
console.log('=== SECTION 7: MULTI-SIGNAL AGREEMENT ===\n');

// Count how many signals agree with trade direction
for (const t of allTrades) {
  const tradeDir = t.hypothetical_decision === 'BUY_UP' ? 1 : -1;
  let agree = 0, total = 0;
  for (const sig of signals) {
    const v = t['signal_' + sig] || 0;
    if (v === 0) continue;
    total++;
    if (Math.sign(v) === tradeDir) agree++;
  }
  t._signalAgree = total > 0 ? agree / total : 0;
  t._signalAgreeCount = agree;
  t._signalTotal = total;
}

console.log('Signal agreement (% of non-zero signals matching trade direction):');
console.log('Agreement  | Trades | Wins | Losses | Win Rate | Avg PnL');
console.log('-----------|--------|------|--------|----------|--------');

const agreeBands = [
  { label: '< 40%',     min: 0, max: 0.40 },
  { label: '40-50%',    min: 0.40, max: 0.50 },
  { label: '50-60%',    min: 0.50, max: 0.60 },
  { label: '60-70%',    min: 0.60, max: 0.70 },
  { label: '70-80%',    min: 0.70, max: 0.80 },
  { label: '80-90%',    min: 0.80, max: 0.90 },
  { label: '90-100%',   min: 0.90, max: 1.01 },
];

for (const band of agreeBands) {
  const sub = allTrades.filter(t => t._signalAgree >= band.min && t._signalAgree < band.max);
  if (sub.length === 0) continue;
  const w = sub.filter(isWin).length;
  const avgPnl = avg(sub.map(t => t.hypothetical_pnl || 0));
  console.log(
    band.label.padEnd(11) + '| ' +
    String(sub.length).padStart(6) + ' | ' +
    String(w).padStart(4) + ' | ' +
    String(sub.length - w).padStart(6) + ' | ' +
    pct(w, sub.length).padStart(8) + ' | ' +
    (avgPnl >= 0 ? '+' : '') + avgPnl.toFixed(4)
  );
}
console.log('');

// ============================================================
// SECTION 8: SCORE MAGNITUDE BANDS
// ============================================================
console.log('=== SECTION 8: SCORE MAGNITUDE vs WIN RATE ===\n');

console.log('|Score| Band  | Trades | Wins | Losses | Win Rate | Avg PnL   | Tot PnL');
console.log('--------------|--------|------|--------|----------|-----------|--------');

const scoreBands = [
  { label: '0-10',   min: 0, max: 10 },
  { label: '10-15',  min: 10, max: 15 },
  { label: '15-20',  min: 15, max: 20 },
  { label: '20-25',  min: 20, max: 25 },
  { label: '25-30',  min: 25, max: 30 },
  { label: '30-40',  min: 30, max: 40 },
  { label: '40-50',  min: 40, max: 50 },
  { label: '50+',    min: 50, max: 999 },
];

for (const band of scoreBands) {
  const sub = allTrades.filter(t => {
    const s = Math.abs(t.final_score || 0);
    return s >= band.min && s < band.max;
  });
  if (sub.length === 0) continue;
  const w = sub.filter(isWin).length;
  const totalPnl = sub.reduce((s, t) => s + (t.hypothetical_pnl || 0), 0);
  const avgPnl = totalPnl / sub.length;
  console.log(
    band.label.padEnd(14) + '| ' +
    String(sub.length).padStart(6) + ' | ' +
    String(w).padStart(4) + ' | ' +
    String(sub.length - w).padStart(6) + ' | ' +
    pct(w, sub.length).padStart(8) + ' | ' +
    (avgPnl >= 0 ? '+' : '') + avgPnl.toFixed(4).padStart(8) + '  | ' +
    (totalPnl >= 0 ? '+' : '') + totalPnl.toFixed(2).padStart(6)
  );
}
console.log('');

// ============================================================
// SECTION 9: CONFIDENCE BANDS
// ============================================================
console.log('=== SECTION 9: CONFIDENCE BANDS vs WIN RATE ===\n');

console.log('Confidence    | Trades | Wins | Losses | Win Rate | Avg PnL   | Tot PnL');
console.log('--------------|--------|------|--------|----------|-----------|--------');

const confBands = [
  { label: '< 20',    min: 0, max: 20 },
  { label: '20-25',   min: 20, max: 25 },
  { label: '25-30',   min: 25, max: 30 },
  { label: '30-35',   min: 30, max: 35 },
  { label: '35-40',   min: 35, max: 40 },
  { label: '40-50',   min: 40, max: 50 },
  { label: '50-60',   min: 50, max: 60 },
  { label: '60+',     min: 60, max: 999 },
];

for (const band of confBands) {
  const sub = allTrades.filter(t => {
    const c = t.confidence || 0;
    return c >= band.min && c < band.max;
  });
  if (sub.length === 0) continue;
  const w = sub.filter(isWin).length;
  const totalPnl = sub.reduce((s, t) => s + (t.hypothetical_pnl || 0), 0);
  const avgPnl = totalPnl / sub.length;
  console.log(
    band.label.padEnd(14) + '| ' +
    String(sub.length).padStart(6) + ' | ' +
    String(w).padStart(4) + ' | ' +
    String(sub.length - w).padStart(6) + ' | ' +
    pct(w, sub.length).padStart(8) + ' | ' +
    (avgPnl >= 0 ? '+' : '') + avgPnl.toFixed(4).padStart(8) + '  | ' +
    (totalPnl >= 0 ? '+' : '') + totalPnl.toFixed(2).padStart(6)
  );
}
console.log('');

// ============================================================
// SECTION 10: EXIT REASON ANALYSIS
// ============================================================
console.log('=== SECTION 10: EXIT REASON ANALYSIS ===\n');

const exitReasons = {};
for (const t of allTrades) {
  const reason = t.exit_reason || 'NULL';
  if (!exitReasons[reason]) exitReasons[reason] = { trades: 0, wins: 0, pnl: 0 };
  exitReasons[reason].trades++;
  if (isWin(t)) exitReasons[reason].wins++;
  exitReasons[reason].pnl += (t.hypothetical_pnl || 0);
}

console.log('Exit Reason         | Trades | Wins | Win Rate | Total PnL');
console.log('--------------------|--------|------|----------|----------');
for (const [reason, stats] of Object.entries(exitReasons).sort((a,b) => b[1].trades - a[1].trades)) {
  console.log(
    reason.padEnd(20) + '| ' +
    String(stats.trades).padStart(6) + ' | ' +
    String(stats.wins).padStart(4) + ' | ' +
    pct(stats.wins, stats.trades).padStart(8) + ' | ' +
    (stats.pnl >= 0 ? '+' : '') + stats.pnl.toFixed(2)
  );
}
console.log('');

// ============================================================
// FINAL SUMMARY
// ============================================================
console.log('================================================================');
console.log('  KEY FINDINGS SUMMARY');
console.log('================================================================');

// Best/worst signals
const bestSig = signalDiffs[0];
const worstSig = signalDiffs[signalDiffs.length - 1];
console.log(`\n1. MOST PREDICTIVE SIGNAL: ${bestSig.sig} (W-L diff: ${bestSig.diff.toFixed(4)})`);
console.log(`   LEAST PREDICTIVE SIGNAL: ${worstSig.sig} (W-L diff: ${worstSig.diff.toFixed(4)})`);

// Best price band
let bestPriceBand = null, bestPriceWR = 0;
for (const band of priceBands) {
  const sub = allTrades.filter(t => {
    const p = entryPrice(t);
    return p != null && p >= band.min && p < band.max;
  });
  if (sub.length < 3) continue;
  const wr = sub.filter(isWin).length / sub.length;
  if (wr > bestPriceWR) { bestPriceWR = wr; bestPriceBand = band.label; }
}
console.log(`\n2. BEST PRICE BAND: ${bestPriceBand} (WR: ${(bestPriceWR*100).toFixed(1)}%)`);

// Best hour
let bestHour = -1, bestHourWR = 0, bestHourMin = 999;
for (let h = 0; h < 24; h++) {
  if (hourStats[h].trades < 3) continue;
  const wr = hourStats[h].wins / hourStats[h].trades;
  if (wr > bestHourWR || (wr === bestHourWR && hourStats[h].trades > bestHourMin)) {
    bestHourWR = wr;
    bestHour = h;
    bestHourMin = hourStats[h].trades;
  }
}
console.log(`\n3. BEST HOUR (UTC): ${bestHour}:00 (WR: ${(bestHourWR*100).toFixed(1)}%, n=${hourStats[bestHour]?.trades || 0})`);

// Direction bias
const upWR = buyUp.filter(isWin).length / (buyUp.length || 1);
const downWR = buyDown.filter(isWin).length / (buyDown.length || 1);
console.log(`\n4. DIRECTION: BUY_UP WR=${(upWR*100).toFixed(1)}% (n=${buyUp.length}) | BUY_DOWN WR=${(downWR*100).toFixed(1)}% (n=${buyDown.length})`);

// Streak clustering
console.log(`\n5. CLUSTERING: After WIN next WR=${pct(afterWin_win, afterWin_total)} | After LOSS next WR=${pct(afterLoss_win, afterLoss_total)}`);
console.log(`   After 2+ LOSSES next WR=${pct(after2L_win, after2L_total)}`);

// Signal agreement
const highAgree = allTrades.filter(t => t._signalAgree >= 0.70);
const lowAgree = allTrades.filter(t => t._signalAgree < 0.50);
const highAgreeWR = highAgree.length > 0 ? highAgree.filter(isWin).length / highAgree.length : 0;
const lowAgreeWR = lowAgree.length > 0 ? lowAgree.filter(isWin).length / lowAgree.length : 0;
console.log(`\n6. SIGNAL AGREEMENT: >=70% agree WR=${(highAgreeWR*100).toFixed(1)}% (n=${highAgree.length}) | <50% agree WR=${(lowAgreeWR*100).toFixed(1)}% (n=${lowAgree.length})`);

console.log('\n================================================================');
console.log('  END OF ANALYSIS');
console.log('================================================================');

db.close();

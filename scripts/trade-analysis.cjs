const Database = require("better-sqlite3");
const db = new Database("data/trading.db");

const total = db.prepare("SELECT COUNT(*) as c FROM training_rounds").get().c;
const allTrades = db.prepare("SELECT * FROM training_rounds WHERE hypothetical_decision != 'SKIP' ORDER BY id ASC").all();
console.log("Toplam round:", total, "| Trade:", allTrades.length, "(" + (allTrades.length/total*100).toFixed(1) + "%)");
console.log("");

// 1. EV=0 BUG
console.log("=== 1. EV=0 TRADE'LER (BUG) ===");
const evZero = allTrades.filter(t => !t.hypothetical_ev || t.hypothetical_ev === 0);
const evValid = allTrades.filter(t => t.hypothetical_ev && t.hypothetical_ev !== 0);
console.log("EV=0 (bug):", evZero.length, "| Valid EV:", evValid.length);
evZero.forEach(r => {
  const resolved = (r.polymarket_up_price > 0.9 || r.polymarket_down_price > 0.9 || r.polymarket_up_price === null);
  console.log("  #" + r.id + " " + r.hypothetical_decision
    + " | Up:" + r.polymarket_up_price + " Down:" + r.polymarket_down_price
    + " | Score:" + r.final_score?.toFixed(1) + " Conf:" + r.confidence?.toFixed(0)
    + " | PnL:" + (r.hypothetical_pnl || 0).toFixed(2)
    + (resolved ? " << RESOLVED/NULL FIYAT" : ""));
});
console.log("");

// 2. CONFIDENCE DILIMLERI
console.log("=== 2. CONFIDENCE DILIMLERI ===");
console.log("Dilim    | Trade | Win | Loss | WR    | PnL");
console.log("---------|-------|-----|------|-------|--------");
[[20,25,"C:20-25"],[25,30,"C:25-30"],[30,35,"C:30-35"],[35,999,"C:35+  "]].forEach(([min,max,label]) => {
  const t = allTrades.filter(x => x.confidence >= min && x.confidence < max);
  let w=0, p=0;
  t.forEach(x => {
    const d = x.hypothetical_decision === "BUY_UP" ? "UP" : "DOWN";
    if (d === x.actual_result) w++;
    p += x.hypothetical_pnl || 0;
  });
  const wr = t.length > 0 ? (w/t.length*100).toFixed(0) : "-";
  console.log(label + " | " + String(t.length).padStart(5) + " | " + String(w).padStart(3) + " | " + String(t.length-w).padStart(4) + " | " + String(wr).padStart(4) + "% | " + (p>=0?"+":"") + p.toFixed(2));
});
console.log("");

// 3. EV DILIMLERI (sadece valid)
console.log("=== 3. EV DILIMLERI (valid trade) ===");
console.log("Dilim       | Trade | Win | Loss | WR    | PnL");
console.log("------------|-------|-----|------|-------|--------");
[[-999,0,"EV<0 (neg) "],[0,0.05,"EV:0-0.05  "],[0.05,0.1,"EV:0.05-0.1"],[0.1,0.2,"EV:0.1-0.2 "],[0.2,0.3,"EV:0.2-0.3 "],[0.3,999,"EV:0.3+    "]].forEach(([min,max,label]) => {
  const t = evValid.filter(x => x.hypothetical_ev >= min && x.hypothetical_ev < max);
  let w=0, p=0;
  t.forEach(x => {
    const d = x.hypothetical_decision === "BUY_UP" ? "UP" : "DOWN";
    if (d === x.actual_result) w++;
    p += x.hypothetical_pnl || 0;
  });
  const wr = t.length > 0 ? (w/t.length*100).toFixed(0) : "-";
  console.log(label + " | " + String(t.length).padStart(5) + " | " + String(w).padStart(3) + " | " + String(t.length-w).padStart(4) + " | " + String(wr).padStart(4) + "% | " + (p>=0?"+":"") + p.toFixed(2));
});
console.log("");

// 4. FIYAT DILIMLERI
console.log("=== 4. FIYAT DILIMLERI ===");
function ep(t) {
  return t.hypothetical_decision === "BUY_UP" ? t.polymarket_up_price : t.polymarket_down_price;
}
console.log("Dilim              | Trade | Win | Loss | WR    | PnL");
console.log("-------------------|-------|-----|------|-------|--------");
[[0,0.25,"Extreme 0-25c  "],[0.25,0.40,"Normal 25-40c  "],[0.40,0.60,"Middle 40-60c  "],[0.60,0.75,"Normal 60-75c  "],[0.75,1.01,"Extreme 75-100c"]].forEach(([min,max,label]) => {
  const t = allTrades.filter(x => { const p = ep(x); return p != null && p >= min && p < max; });
  let w=0, p=0;
  t.forEach(x => {
    const d = x.hypothetical_decision === "BUY_UP" ? "UP" : "DOWN";
    if (d === x.actual_result) w++;
    p += x.hypothetical_pnl || 0;
  });
  const wr = t.length > 0 ? (w/t.length*100).toFixed(0) : "-";
  console.log(label + "  | " + String(t.length).padStart(5) + " | " + String(w).padStart(3) + " | " + String(t.length-w).padStart(4) + " | " + String(wr).padStart(4) + "% | " + (p>=0?"+":"") + p.toFixed(2));
});
const nullP = allTrades.filter(t => ep(t) == null);
if (nullP.length > 0) console.log("NULL fiyat          | " + String(nullP.length).padStart(5) + " (eski bug kayitlar)");
console.log("");

// 5. UP vs DOWN BIAS
console.log("=== 5. UP vs DOWN BIAS ===");
function calcStats(trades, label) {
  let w=0, p=0;
  trades.forEach(x => {
    const d = x.hypothetical_decision === "BUY_UP" ? "UP" : "DOWN";
    if (d === x.actual_result) w++;
    p += x.hypothetical_pnl || 0;
  });
  const wr = trades.length > 0 ? (w/trades.length*100).toFixed(0) : "-";
  console.log(label + ": " + trades.length + " trade | W:" + w + " L:" + (trades.length-w) + " | WR:" + wr + "% | PnL:" + (p>=0?"+":"") + p.toFixed(2));
}
calcStats(allTrades.filter(t => t.hypothetical_decision === "BUY_UP"), "BUY_UP  ");
calcStats(allTrades.filter(t => t.hypothetical_decision === "BUY_DOWN"), "BUY_DOWN");
const allUp = db.prepare("SELECT COUNT(*) as c FROM training_rounds WHERE actual_result = 'UP'").get().c;
const allDown = db.prepare("SELECT COUNT(*) as c FROM training_rounds WHERE actual_result = 'DOWN'").get().c;
console.log("Market gercek dagilim: UP:" + allUp + " DOWN:" + allDown + " (" + (allUp/total*100).toFixed(0) + "/" + (allDown/total*100).toFixed(0) + "%)");
console.log("");

// DETAYLI TRADE LISTESI
console.log("=== TUM TRADELER (DETAY) ===");
console.log("ID  | Zaman | Karar    | Score | Conf | EV     | Fiyat | Sonuc | PnL");
console.log("----|-------|----------|-------|------|--------|-------|-------|-------");
allTrades.forEach(t => {
  const dir = t.hypothetical_decision === "BUY_UP" ? "UP" : "DOWN";
  const won = dir === t.actual_result;
  const price = ep(t);
  console.log(
    String(t.id).padStart(3) + " | " +
    t.round_start_time.slice(11,16) + " | " +
    t.hypothetical_decision.padEnd(8) + " | " +
    t.final_score?.toFixed(1).padStart(5) + " | " +
    t.confidence?.toFixed(0).padStart(4) + " | " +
    (t.hypothetical_ev?.toFixed(3) || "0.000").padStart(6) + " | " +
    (price != null ? (price*100).toFixed(0)+"c" : "null").padStart(5) + " | " +
    (won ? " WIN " : " LOSS") + " | " +
    ((t.hypothetical_pnl||0)>=0?"+":"") + (t.hypothetical_pnl||0).toFixed(2)
  );
});

// OZET
console.log("");
console.log("=== GENEL OZET ===");
let tw=0, tp=0;
allTrades.forEach(t => {
  const d = t.hypothetical_decision === "BUY_UP" ? "UP" : "DOWN";
  if (d === t.actual_result) tw++;
  tp += t.hypothetical_pnl || 0;
});
console.log("Toplam trade:", allTrades.length);
console.log("Win rate:", (tw/allTrades.length*100).toFixed(1) + "%");
console.log("Net PnL: $" + tp.toFixed(2));
console.log("EV=0 bug trade:", evZero.length);
console.log("Valid EV trade:", evValid.length);

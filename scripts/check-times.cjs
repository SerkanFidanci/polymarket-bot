const Database = require("better-sqlite3");
const db = new Database("data/trading.db");

// Fotoğraftaki trade: giriş 04-08 15:10, çıkış 15:00 — 10dk fark
// round_start_time ve round_end_time kontrol

console.log("=== SON TRADELER: ZAMAN KONTROLÜ ===");
const bl = db.prepare("SELECT id, round_start_time, round_end_time FROM training_rounds WHERE hypothetical_decision != 'SKIP' AND polymarket_up_price > 0.01 ORDER BY id DESC LIMIT 10").all();
bl.forEach(t => {
  const s = new Date(t.round_start_time);
  const e = new Date(t.round_end_time);
  const diffMin = (e - s) / 60000;
  console.log("#"+t.id, "start:", t.round_start_time?.slice(11,16), "end:", t.round_end_time?.slice(11,16), "fark:", diffMin.toFixed(1)+"dk", diffMin < 0 ? "⚠️ END < START!" : diffMin > 6 ? "⚠️ >6dk" : "✅");
});

console.log("");
console.log("=== STRATEGY TRADES: ZAMAN KONTROLÜ ===");
const st = db.prepare("SELECT st.id, st.strategy_name, st.created_at, tr.round_start_time, tr.round_end_time FROM strategy_trades st LEFT JOIN training_rounds tr ON st.round_id = tr.id ORDER BY st.id DESC LIMIT 10").all();
st.forEach(t => {
  const girisSaat = t.created_at?.slice(11,16) || t.round_start_time?.slice(11,16);
  const cikisSaat = t.round_end_time?.slice(11,16);
  console.log("#"+t.id, t.strategy_name?.padEnd(16), "giriş:", girisSaat, "çıkış:", cikisSaat);

  if (girisSaat && cikisSaat) {
    const [gh,gm] = girisSaat.split(":").map(Number);
    const [ch,cm] = cikisSaat.split(":").map(Number);
    const diffM = (ch*60+cm) - (gh*60+gm);
    if (diffM < 0) console.log("  ⚠️ ÇIKIŞ GİRİŞTEN ÖNCE! (fark:", diffM, "dk)");
  }
});

// Fotoğraftaki spesifik durum: giriş 15:10, çıkış 15:00
console.log("");
console.log("=== SORUN ANALİZİ ===");
console.log("Fotoğraf: Giriş 15:10, Çıkış 15:00 → çıkış girişten 10dk ÖNCE");
console.log("");

// round_start_time = PM window start (biz bunu set ediyoruz)
// round_end_time = round_start_time + 300000 (5dk sonra)
// Eğer giriş round_start_time ve çıkış round_end_time ise:");
// round_start = 15:10, round_end = 15:10 + 5dk = 15:15 olmalı

// AMA frontend'de:
// time = round_start_time (giriş zamanı olarak gösteriliyor)
// end_time = round_end_time
// Strategy trades: created_at ≠ round_start_time!
// created_at = trade kaydedildiği an (round bittiğinde)
// round_start_time = PM window başlangıcı

// Sorun: strategy_trades.created_at = round END zamanı (round bittiğinde kaydediliyor)
// Ama frontend bunu "giriş zamanı" olarak gösteriyor
console.log("KÖK SEBEP:");
console.log("  BASELINE: time = round_start_time (doğru)");
console.log("  STRATEGY: time = created_at (YANLIŞ — bu round bittikten sonraki kayıt zamanı)");
console.log("  end_time = round_end_time");
console.log("");
console.log("  Eğer round 15:00-15:05 ise:");
console.log("  BASELINE: giriş=15:00, çıkış=15:05 ✅");
console.log("  STRATEGY: giriş=15:10 (kaydedildiği an!), çıkış=15:05 ← ÇIKIŞ ÖNCEKİ ROUND!");

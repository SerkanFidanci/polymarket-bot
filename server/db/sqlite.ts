import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', '..', 'data', 'trading.db');

// Ensure data directory exists
import fs from 'fs';
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Run migrations
export function initDatabase(): void {
  db.exec(`
    -- Core trading tables
    CREATE TABLE IF NOT EXISTS bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      round_id TEXT,
      market_id TEXT,
      direction TEXT NOT NULL,
      entry_price REAL NOT NULL,
      bet_size REAL NOT NULL,
      contracts INTEGER NOT NULL,
      final_score REAL,
      confidence REAL,
      ev REAL,
      our_probability REAL,
      signal_orderbook REAL,
      signal_ema_macd REAL,
      signal_rsi_stoch REAL,
      signal_vwap_bb REAL,
      signal_cvd REAL,
      signal_whale REAL,
      signal_funding REAL,
      signal_open_interest REAL,
      signal_liquidation REAL,
      signal_ls_ratio REAL,
      result TEXT,
      pnl REAL,
      bankroll_after REAL,
      polymarket_order_id TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS system_state (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS daily_stats (
      date TEXT PRIMARY KEY,
      starting_balance REAL,
      ending_balance REAL,
      total_bets INTEGER,
      wins INTEGER,
      losses INTEGER,
      skips INTEGER,
      pnl REAL,
      best_bet REAL,
      worst_bet REAL
    );

    CREATE TABLE IF NOT EXISTS signal_performance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT,
      signal_name TEXT,
      signal_score REAL,
      actual_result TEXT,
      was_correct INTEGER
    );

    -- Training tables
    CREATE TABLE IF NOT EXISTS training_rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_start_time TEXT NOT NULL,
      round_end_time TEXT NOT NULL,
      btc_price_start REAL NOT NULL,
      btc_price_end REAL NOT NULL,
      actual_result TEXT NOT NULL,
      polymarket_up_price REAL,
      polymarket_down_price REAL,
      signal_orderbook REAL,
      signal_ema_macd REAL,
      signal_rsi_stoch REAL,
      signal_vwap_bb REAL,
      signal_cvd REAL,
      signal_whale REAL,
      signal_funding REAL,
      signal_open_interest REAL,
      signal_liquidation REAL,
      signal_ls_ratio REAL,
      final_score REAL,
      confidence REAL,
      hypothetical_decision TEXT,
      hypothetical_ev REAL,
      hypothetical_bet_size REAL,
      hypothetical_pnl REAL,
      market_volatility_1m REAL,
      market_volatility_5m REAL,
      orderbook_spread REAL,
      avg_trade_volume_1m REAL,
      whale_count_2m INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS paper_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_id INTEGER REFERENCES training_rounds(id),
      paper_bankroll_before REAL NOT NULL,
      paper_bet_direction TEXT NOT NULL,
      paper_bet_size REAL NOT NULL,
      paper_entry_price REAL NOT NULL,
      paper_result TEXT,
      paper_pnl REAL,
      paper_bankroll_after REAL,
      signal_weights_used TEXT,
      threshold_config_used TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS optimization_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      optimization_type TEXT NOT NULL,
      rounds_analyzed INTEGER NOT NULL,
      old_weights TEXT NOT NULL,
      new_weights TEXT NOT NULL,
      old_thresholds TEXT,
      new_thresholds TEXT,
      old_simulated_pnl REAL,
      new_simulated_pnl REAL,
      improvement_percent REAL,
      applied INTEGER NOT NULL DEFAULT 0,
      reason TEXT
    );

    CREATE TABLE IF NOT EXISTS signal_accuracy_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      signal_name TEXT NOT NULL,
      period_rounds INTEGER NOT NULL,
      accuracy REAL NOT NULL,
      edge_over_random REAL NOT NULL,
      abstain_rate REAL,
      current_weight REAL NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_report (
      date TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      total_rounds INTEGER,
      rounds_entered INTEGER,
      rounds_skipped INTEGER,
      wins INTEGER,
      losses INTEGER,
      win_rate REAL,
      total_pnl REAL,
      max_drawdown REAL,
      best_signal TEXT,
      worst_signal TEXT,
      avg_ev REAL,
      avg_confidence REAL,
      weights_updated INTEGER DEFAULT 0,
      notes TEXT
    );

    -- Signal retirement log
    CREATE TABLE IF NOT EXISTS signal_retirement_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      signal_name TEXT NOT NULL,
      action TEXT NOT NULL,
      accuracy REAL,
      reason TEXT
    );

    -- Initialize system state
    INSERT OR IGNORE INTO system_state (key, value, updated_at) VALUES ('trading_mode', 'passive', datetime('now'));
    INSERT OR IGNORE INTO system_state (key, value, updated_at) VALUES ('bankroll', '50', datetime('now'));
    INSERT OR IGNORE INTO system_state (key, value, updated_at) VALUES ('system_status', 'INITIALIZING', datetime('now'));
  `);

  // Migrations — add columns if missing
  try {
    db.exec(`ALTER TABLE training_rounds ADD COLUMN polymarket_fee_rate REAL`);
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE training_rounds ADD COLUMN orderbook_spread_at_entry REAL`);
  } catch { /* column already exists */ }

  console.log('[DB] Database initialized at', DB_PATH);
}

export { db };
export default db;

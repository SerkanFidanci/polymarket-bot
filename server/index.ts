import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { db, initDatabase } from './db/sqlite.js';
import polymarketRoutes from './polymarket/routes.js';
import { serverStreamManager } from './stream-manager.js';
import { serverSignalEngine } from './signal-engine.js';
import { serverTrainingLoop } from './training-loop.js';
import { serverBinanceWS } from './binance-ws.js';
import { strategyManager } from './strategy-manager.js';

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

// Initialize database
initDatabase();

// ===== API Routes =====

// Live data endpoint — frontend polls this for server-side signal/round data
app.get('/api/live-data', (_req, res) => {
  try {
    const signal = serverSignalEngine.getLastSignal();
    const tracking = serverTrainingLoop.getTrackingState();
    // Read trading mode from DB
    const modeRow = db.prepare("SELECT value FROM system_state WHERE key = 'trading_mode'").get() as { value: string } | undefined;
    const tradingMode = modeRow?.value ?? 'passive';

    res.json({
      btcPrice: serverBinanceWS.lastTradePrice,
      isConnected: serverBinanceWS.isConnected,
      tradingMode,
      weights: serverSignalEngine.getWeights(),
      signal: signal ? {
        finalScore: signal.finalScore,
        confidence: signal.confidence,
        signals: signal.signals,
        groupScores: signal.groupScores,
        allGroupsAgree: signal.allGroupsAgree,
        timestamp: signal.timestamp,
      } : null,
      training: {
        roundCount: tracking.roundCounter,
        currentSlug: tracking.currentSlug,
        roundStartPrice: tracking.roundStartPrice,
        roundUpPrice: tracking.roundUpPrice,
        roundDownPrice: tracking.roundDownPrice,
        hasSignalSnapshot: tracking.hasSignalSnapshot,
      },
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Manual accuracy check trigger
app.post('/api/training/accuracy-check', async (_req, res) => {
  try {
    await serverTrainingLoop.runAccuracyNow();
    const accuracies = serverTrainingLoop.getLastAccuracies();
    res.json({ ok: true, accuracies });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Manual optimization trigger
app.post('/api/training/optimize', async (_req, res) => {
  try {
    await serverTrainingLoop.runOptimizationNow();
    res.json({ ok: true, weights: serverSignalEngine.getWeights() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// System state
app.get('/api/state', (_req, res) => {
  try {
    const rows = db.prepare('SELECT key, value FROM system_state').all() as { key: string; value: string }[];
    const state: Record<string, string> = {};
    for (const row of rows) state[row.key] = row.value;
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/state', (req, res) => {
  try {
    const { key, value } = req.body as { key: string; value: string };
    db.prepare('INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))').run(key, value);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Training rounds (with dedup: reject if same round_start_time exists within 60s)
app.post('/api/training-rounds', (req, res) => {
  try {
    const r = req.body;
    // Dedup: check if a round with same start time (within 30s) already exists
    const existing = db.prepare(
      `SELECT id FROM training_rounds WHERE abs(strftime('%s', round_start_time) - strftime('%s', ?)) < 120 LIMIT 1`
    ).get(r.roundStartTime) as { id: number } | undefined;
    if (existing) {
      res.json({ id: existing.id, deduplicated: true });
      return;
    }
    const stmt = db.prepare(`
      INSERT INTO training_rounds (
        round_start_time, round_end_time, btc_price_start, btc_price_end,
        actual_result, polymarket_up_price, polymarket_down_price,
        signal_orderbook, signal_ema_macd, signal_rsi_stoch, signal_vwap_bb,
        signal_cvd, signal_whale, signal_funding, signal_open_interest,
        signal_liquidation, signal_ls_ratio, final_score, confidence,
        hypothetical_decision, hypothetical_ev, hypothetical_bet_size, hypothetical_pnl,
        market_volatility_1m, market_volatility_5m, orderbook_spread,
        avg_trade_volume_1m, whale_count_2m
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      r.roundStartTime, r.roundEndTime, r.btcPriceStart, r.btcPriceEnd,
      r.actualResult, r.polymarketUpPrice ?? null, r.polymarketDownPrice ?? null,
      r.signalOrderbook, r.signalEmaMacd, r.signalRsiStoch, r.signalVwapBb,
      r.signalCvd, r.signalWhale, r.signalFunding, r.signalOpenInterest,
      r.signalLiquidation, r.signalLsRatio, r.finalScore, r.confidence,
      r.hypotheticalDecision, r.hypotheticalEv, r.hypotheticalBetSize, r.hypotheticalPnl,
      r.marketVolatility1m ?? null, r.marketVolatility5m ?? null, r.orderbookSpread ?? null,
      r.avgTradeVolume1m ?? null, r.whaleCount2m ?? null,
    );
    res.json({ id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/training-rounds', (_req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM training_rounds ORDER BY id DESC LIMIT 100').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Reset training data only (NOT paper trades)
app.post('/api/training-rounds/reset', (_req, res) => {
  try {
    db.prepare('DELETE FROM training_rounds').run();
    db.prepare('DELETE FROM signal_accuracy_log').run();
    db.prepare('DELETE FROM optimization_history').run();
    res.json({ ok: true, message: 'Training data cleared' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Hypothetical trades (BUY only, not SKIP, valid prices only)
app.get('/api/training-rounds/trades', (_req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, round_start_time, actual_result, hypothetical_decision,
             hypothetical_ev, hypothetical_pnl, hypothetical_bet_size,
             confidence, final_score, polymarket_up_price, polymarket_down_price
      FROM training_rounds
      WHERE hypothetical_decision != 'SKIP'
        AND polymarket_up_price IS NOT NULL
        AND polymarket_up_price > 0.01
      ORDER BY id DESC LIMIT 50
    `).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Last N round results (for PolymarketPanel)
app.get('/api/training-rounds/recent', (_req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, actual_result, hypothetical_decision
      FROM training_rounds ORDER BY id DESC LIMIT 5
    `).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/training-rounds/count', (_req, res) => {
  try {
    const row = db.prepare('SELECT COUNT(*) as count FROM training_rounds').get() as { count: number };
    res.json({ count: row.count });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Bets
app.get('/api/bets', (_req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM bets ORDER BY id DESC LIMIT 50').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Daily stats
app.get('/api/daily-stats', (_req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM daily_stats ORDER BY date DESC LIMIT 7').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Signal accuracy
app.get('/api/signal-accuracy', (_req, res) => {
  try {
    const rows = db.prepare(`
      SELECT signal_name,
        COUNT(*) as total,
        SUM(CASE WHEN was_correct = 1 THEN 1 ELSE 0 END) as correct,
        ROUND(CAST(SUM(CASE WHEN was_correct = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*), 4) as accuracy
      FROM signal_performance
      GROUP BY signal_name
    `).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Paper trades
app.get('/api/paper-trades', (_req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM paper_trades ORDER BY id DESC LIMIT 50').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Manual paper trading — open position
app.post('/api/paper-trades/open', (req, res) => {
  try {
    const { direction, betSize, entryPrice, roundSlug, roundTitle, btcPrice, bankrollBefore } = req.body as {
      direction: string; betSize: number; entryPrice: number;
      roundSlug: string; roundTitle: string; btcPrice: number; bankrollBefore: number;
    };
    // Check no open position exists
    const open = db.prepare(`SELECT id FROM paper_trades WHERE paper_result IS NULL LIMIT 1`).get();
    if (open) {
      res.status(400).json({ error: 'Already have an open position' });
      return;
    }
    const stmt = db.prepare(`
      INSERT INTO paper_trades (round_id, paper_bankroll_before, paper_bet_direction, paper_bet_size, paper_entry_price, signal_weights_used, threshold_config_used)
      VALUES (NULL, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(bankrollBefore, direction, betSize, entryPrice, roundSlug, roundTitle);
    res.json({ id: result.lastInsertRowid, direction, betSize, entryPrice });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Manual paper trading — resolve open position
// Two modes:
//   1. Round expiry: actualResult determines WIN/LOSS, pnl = full win or full loss
//   2. Manual exit: pnlOverride is set, sell tokens at current market price
app.post('/api/paper-trades/resolve', (req, res) => {
  try {
    const { actualResult, pnlOverride } = req.body as {
      actualResult: string; btcPriceEnd: number;
      manualExit?: boolean; exitPrice?: number; pnlOverride?: number;
    };
    const open = db.prepare(`SELECT * FROM paper_trades WHERE paper_result IS NULL ORDER BY id DESC LIMIT 1`).get() as {
      id: number; paper_bet_direction: string; paper_bet_size: number;
      paper_entry_price: number; paper_bankroll_before: number;
    } | undefined;
    if (!open) {
      res.status(400).json({ error: 'No open position' });
      return;
    }

    let pnl: number;
    if (pnlOverride !== undefined) {
      // Manual exit — P&L calculated by frontend based on current market price
      pnl = pnlOverride;
    } else {
      // Round expiry — token = $1 if correct, $0 if wrong
      const won = open.paper_bet_direction === actualResult;
      const price = open.paper_entry_price;
      pnl = won ? open.paper_bet_size * ((1 - price) / price) : -open.paper_bet_size;
    }

    const won = pnl >= 0;
    const bankrollAfter = open.paper_bankroll_before + pnl;
    db.prepare(`UPDATE paper_trades SET paper_result = ?, paper_pnl = ?, paper_bankroll_after = ? WHERE id = ?`)
      .run(won ? 'WIN' : 'LOSS', pnl, bankrollAfter, open.id);
    res.json({ id: open.id, result: won ? 'WIN' : 'LOSS', pnl, bankrollAfter });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get open position
app.get('/api/paper-trades/open', (_req, res) => {
  try {
    const open = db.prepare(`SELECT * FROM paper_trades WHERE paper_result IS NULL ORDER BY id DESC LIMIT 1`).get();
    res.json(open ?? { none: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Paper balance (last trade's bankroll_after, or initial $50)
app.get('/api/paper-trades/balance', (_req, res) => {
  try {
    const last = db.prepare(`SELECT paper_bankroll_after FROM paper_trades WHERE paper_result IS NOT NULL ORDER BY id DESC LIMIT 1`).get() as { paper_bankroll_after: number } | undefined;
    const count = db.prepare(`SELECT COUNT(*) as c FROM paper_trades WHERE paper_result IS NOT NULL`).get() as { c: number };
    const wins = db.prepare(`SELECT COUNT(*) as c FROM paper_trades WHERE paper_result = 'WIN'`).get() as { c: number };
    const totalPnl = db.prepare(`SELECT COALESCE(SUM(paper_pnl), 0) as total FROM paper_trades WHERE paper_result IS NOT NULL`).get() as { total: number };
    res.json({
      balance: last?.paper_bankroll_after ?? 50,
      totalTrades: count.c,
      wins: wins.c,
      losses: count.c - wins.c,
      winRate: count.c > 0 ? wins.c / count.c : 0,
      totalPnl: totalPnl.total,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Training rounds - all data for optimization
app.get('/api/training-rounds/all', (_req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM training_rounds ORDER BY id ASC').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Optimization history
app.post('/api/optimization-history', (req, res) => {
  try {
    const r = req.body;
    db.prepare(`
      INSERT INTO optimization_history (timestamp, optimization_type, rounds_analyzed, old_weights, new_weights, old_thresholds, new_thresholds, old_simulated_pnl, new_simulated_pnl, improvement_percent, applied, reason)
      VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(r.type, r.roundsAnalyzed, r.oldWeights, r.newWeights, r.oldThresholds ?? null, r.newThresholds ?? null, r.oldPnl, r.newPnl, r.improvement, r.applied ? 1 : 0, r.reason);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/optimization-history', (_req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM optimization_history ORDER BY id DESC LIMIT 20').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Signal accuracy log
app.post('/api/signal-accuracy-log', (req, res) => {
  try {
    const items = req.body as Array<{ signalName: string; periodRounds: number; accuracy: number; edgeOverRandom: number; abstainRate: number; currentWeight: number; status: string }>;
    const stmt = db.prepare(`
      INSERT INTO signal_accuracy_log (timestamp, signal_name, period_rounds, accuracy, edge_over_random, abstain_rate, current_weight, status)
      VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of items) {
      stmt.run(item.signalName, item.periodRounds, item.accuracy, item.edgeOverRandom, item.abstainRate, item.currentWeight, item.status);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/signal-accuracy-log', (_req, res) => {
  try {
    const rows = db.prepare(`
      SELECT * FROM signal_accuracy_log WHERE id IN (
        SELECT MAX(id) FROM signal_accuracy_log GROUP BY signal_name
      ) ORDER BY signal_name
    `).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Daily report
app.post('/api/daily-report', (req, res) => {
  try {
    const r = req.body;
    db.prepare(`
      INSERT OR REPLACE INTO daily_report (date, mode, total_rounds, rounds_entered, rounds_skipped, wins, losses, win_rate, total_pnl, max_drawdown, best_signal, worst_signal, avg_ev, avg_confidence, weights_updated, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(r.date, r.mode, r.totalRounds, r.roundsEntered, r.roundsSkipped, r.wins, r.losses, r.winRate, r.totalPnl, r.maxDrawdown, r.bestSignal, r.worstSignal, r.avgEv, r.avgConfidence, r.weightsUpdated ? 1 : 0, r.notes ?? null);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/daily-report', (_req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM daily_report ORDER BY date DESC LIMIT 7').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Paper trades count
app.get('/api/paper-trades/count', (_req, res) => {
  try {
    const row = db.prepare('SELECT COUNT(*) as count FROM paper_trades').get() as { count: number };
    res.json({ count: row.count });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Strategy leaderboard
app.get('/api/strategies/leaderboard', (_req, res) => {
  try {
    res.json(strategyManager.getLeaderboard());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Strategy trades
app.get('/api/strategies/:name/trades', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM strategy_trades WHERE strategy_name = ? ORDER BY id DESC LIMIT 50').all(req.params.name);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Polymarket API proxy
app.use('/api/polymarket', polymarketRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve built frontend in production
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname2, '..', 'dist');

import fs from 'fs';
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.use((_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
  console.log('[Server] Serving frontend from', distPath);
}

app.listen(PORT, () => {
  console.log(`[Server] Running on http://localhost:${PORT}`);

  // Boot server-side data pipeline (Binance WS + Signals + Training Loop)
  // This runs independently of the frontend browser
  (async () => {
    try {
      console.log('[Server] Starting server-side data pipeline...');

      // 1. Connect Binance WebSocket + Futures REST polling
      await serverStreamManager.start();
      console.log('[Server] Binance streams connected');

      // 2. Start signal engine (every 1 second)
      serverSignalEngine.start(1000);
      console.log('[Server] Signal engine started');

      // 3. Start training loop (polls PM rounds every 10s, records to DB)
      // This is the critical part — runs 24/7 even when browser is closed
      serverTrainingLoop.start();
      console.log('[Server] Training loop started — recording rounds 24/7');
    } catch (err) {
      console.error('[Server] Failed to start data pipeline:', err);
    }
  })();
});

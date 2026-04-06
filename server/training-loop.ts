import { serverBinanceWS } from './binance-ws.js';
import { serverSignalEngine } from './signal-engine.js';
import { polymarketClient } from './polymarket/client.js';
import { db } from './db/sqlite.js';
import type { CombinedSignal } from '../src/types/index.js';
import { measureAllSignalAccuracy, runOptimizationCycle } from '../src/engine/OptimizationEngine.js';
import type { SignalAccuracy } from '../src/types/signals.js';

let trainingInterval: ReturnType<typeof setInterval> | null = null;
let roundCounter = getRoundCountFromDB();

function getRoundCountFromDB(): number {
  try {
    const row = db.prepare('SELECT COUNT(*) as count FROM training_rounds').get() as { count: number };
    return row.count;
  } catch {
    return 0;
  }
}

// Training state — initialize from DB to survive PM2 restarts
function getCounterFromDB(): { sinceAccuracy: number; sinceOptimize: number } {
  try {
    const totalRounds = db.prepare('SELECT COUNT(*) as c FROM training_rounds').get() as { c: number };

    // Rounds since last accuracy check
    const lastAcc = db.prepare('SELECT MAX(period_rounds) as r FROM signal_accuracy_log').get() as { r: number | null };
    const sinceAccuracy = lastAcc.r ? totalRounds.c - lastAcc.r : totalRounds.c;

    // Rounds since last optimization
    const lastOpt = db.prepare('SELECT MAX(rounds_analyzed) as r FROM optimization_history').get() as { r: number | null };
    const sinceOptimize = lastOpt.r ? totalRounds.c - lastOpt.r : totalRounds.c;

    return { sinceAccuracy: Math.max(0, sinceAccuracy), sinceOptimize: Math.max(0, sinceOptimize) };
  } catch {
    return { sinceAccuracy: 0, sinceOptimize: 0 };
  }
}

const initialCounters = getCounterFromDB();
let roundsSinceLastAccuracyCheck = initialCounters.sinceAccuracy;
let roundsSinceLastOptimize = initialCounters.sinceOptimize;
let lastAccuracies: SignalAccuracy[] = [];

console.log(`[TrainingLoop] Counters from DB: sinceAccuracy=${roundsSinceLastAccuracyCheck}, sinceOptimize=${roundsSinceLastOptimize}`);

function getAllTrainingRounds(): unknown[] {
  return db.prepare('SELECT * FROM training_rounds ORDER BY id ASC').all();
}

function logAccuracyToDB(accuracies: SignalAccuracy[]) {
  const weights = serverSignalEngine.getWeights();
  const stmt = db.prepare(`
    INSERT INTO signal_accuracy_log (timestamp, signal_name, period_rounds, accuracy, edge_over_random, abstain_rate, current_weight, status)
    VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const a of accuracies) {
    stmt.run(
      a.signalName,
      a.totalPredictions + Math.round(a.abstainRate * a.totalPredictions / (1 - a.abstainRate || 1)),
      a.accuracy, a.edgeOverRandom, a.abstainRate,
      weights[a.signalName], a.status
    );
  }
}

function logOptimizationToDB(
  type: string, roundsAnalyzed: number,
  oldWeights: string, newWeights: string,
  oldPnl: number, newPnl: number,
  improvement: number, applied: boolean, reason: string
) {
  db.prepare(`
    INSERT INTO optimization_history (timestamp, optimization_type, rounds_analyzed, old_weights, new_weights, old_simulated_pnl, new_simulated_pnl, improvement_percent, applied, reason)
    VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(type, roundsAnalyzed, oldWeights, newWeights, oldPnl, newPnl, improvement, applied ? 1 : 0, reason);
}

async function runAccuracyCheck() {
  const rounds = getAllTrainingRounds();
  if (rounds.length < 20) return;

  const currentWeights = serverSignalEngine.getWeights();
  const accuracies = measureAllSignalAccuracy(rounds as Parameters<typeof measureAllSignalAccuracy>[0]);
  lastAccuracies = accuracies;

  logAccuracyToDB(accuracies);

  console.log(`[TrainingLoop] Accuracy check (${rounds.length} rounds): ${accuracies.map(a => `${a.signalName}:${(a.accuracy * 100).toFixed(1)}%`).join(', ')}`);
}

async function runFullOptimization() {
  const rounds = getAllTrainingRounds();
  if (rounds.length < 100) return;

  const currentWeights = serverSignalEngine.getWeights();

  const result = await runOptimizationCycle(
    rounds as Parameters<typeof runOptimizationCycle>[0],
    currentWeights,
    roundsSinceLastOptimize
  );

  lastAccuracies = result.accuracies;

  if (result.proposedWeights && result.applied) {
    serverSignalEngine.setWeights(result.proposedWeights);

    logOptimizationToDB(
      'weights', rounds.length,
      JSON.stringify(currentWeights), JSON.stringify(result.proposedWeights),
      0, 0, 0, true, result.reason
    );

    console.log(`[TrainingLoop] Weights updated: ${result.reason}`);
  } else {
    logOptimizationToDB(
      'weights', rounds.length,
      JSON.stringify(currentWeights), JSON.stringify(currentWeights),
      0, 0, 0, false, result.reason
    );
    console.log(`[TrainingLoop] Optimization: ${result.reason}`);
  }
}

function onRoundRecorded() {
  roundsSinceLastAccuracyCheck++;
  roundsSinceLastOptimize++;

  // Every 100 rounds: measure accuracy
  if (roundsSinceLastAccuracyCheck >= 100) {
    roundsSinceLastAccuracyCheck = 0;
    runAccuracyCheck().catch(err => console.error('[TrainingLoop] Accuracy check error:', err));
  }

  // Every 200 rounds: edge-based optimization (or full at 500)
  if (roundsSinceLastOptimize >= 200) {
    runFullOptimization().catch(err => console.error('[TrainingLoop] Optimization error:', err));
    // Don't reset counter — let it accumulate to 500 for grid search
    // runOptimizationCycle checks roundsSinceLastOptimize internally
    if (roundsSinceLastOptimize >= 500) {
      roundsSinceLastOptimize = 0;
    }
  }
}

// Round tracking state
let currentSlug = '';
let currentTokenIdUp = '';
let currentTokenIdDown = '';
let roundStartPrice = 0;
let roundUpPrice = 0;        // Updates during round (for live display)
let roundUpPriceAtStart = 0; // Snapshot at round start (for hypothetical decision)
let roundDownPriceAtStart = 0;
let roundFeeRate = 0;
let roundSpread = 0;
let roundDownPrice = 0;
let roundStartTime = '';
let startSignalSnapshot: CombinedSignal | null = null;


function saveRound(roundData: Record<string, unknown>): number | null {
  try {
    // Dedup check
    const existing = db.prepare(
      `SELECT id FROM training_rounds WHERE abs(strftime('%s', round_start_time) - strftime('%s', ?)) < 120 LIMIT 1`
    ).get(roundData.roundStartTime) as { id: number } | undefined;

    if (existing) {
      return null; // Dedup — don't count as new round
    }

    const stmt = db.prepare(`
      INSERT INTO training_rounds (
        round_start_time, round_end_time, btc_price_start, btc_price_end,
        actual_result, polymarket_up_price, polymarket_down_price,
        signal_orderbook, signal_ema_macd, signal_rsi_stoch, signal_vwap_bb,
        signal_cvd, signal_whale, signal_funding, signal_open_interest,
        signal_liquidation, signal_ls_ratio, final_score, confidence,
        hypothetical_decision, hypothetical_ev, hypothetical_bet_size, hypothetical_pnl,
        polymarket_fee_rate, orderbook_spread_at_entry
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      roundData.roundStartTime, roundData.roundEndTime,
      roundData.btcPriceStart, roundData.btcPriceEnd,
      roundData.actualResult,
      roundData.polymarketUpPrice ?? null, roundData.polymarketDownPrice ?? null,
      roundData.signalOrderbook, roundData.signalEmaMacd,
      roundData.signalRsiStoch, roundData.signalVwapBb,
      roundData.signalCvd, roundData.signalWhale,
      roundData.signalFunding, roundData.signalOpenInterest,
      roundData.signalLiquidation, roundData.signalLsRatio,
      roundData.finalScore, roundData.confidence,
      roundData.hypotheticalDecision, roundData.hypotheticalEv,
      roundData.hypotheticalBetSize, roundData.hypotheticalPnl,
      roundData.polymarketFeeRate ?? null, roundData.orderbookSpread ?? null,
    );

    return result.lastInsertRowid as number;
  } catch (err) {
    console.error('[TrainingLoop] Save failed:', err);
    return null;
  }
}

async function refreshPrices(tokenIdUp: string, tokenIdDown: string, slug: string): Promise<{ priceUp: number; priceDown: number } | null> {
  try {
    return await polymarketClient.refreshPrices(tokenIdUp, tokenIdDown, slug);
  } catch {
    return null;
  }
}

async function pollRound(): Promise<void> {
  try {
    // Fetch current Polymarket round (directly from Gamma API, not via HTTP)
    const round = await polymarketClient.findCurrentBtcRound();

    if (!round || !round.slug) return;

    // NEW ROUND detected — save previous round's result and start tracking new one
    if (round.slug !== currentSlug) {
      // Save previous round (if we had one)
      if (currentSlug && roundStartPrice > 0 && startSignalSnapshot) {
        const endPrice = serverBinanceWS.lastTradePrice;

        // Determine result from Polymarket prices
        let result: string;
        if (roundUpPrice > 0.7) {
          result = 'UP';
        } else if (roundDownPrice > 0.7) {
          result = 'DOWN';
        } else {
          // PM prices not yet resolved — fallback to BTC price
          result = endPrice >= roundStartPrice ? 'UP' : 'DOWN';
        }

        // Calculate hypothetical decision (with fee)
        const score = startSignalSnapshot.finalScore;
        const conf = startSignalSnapshot.confidence;
        let hypDecision = 'SKIP';
        let hypBetSize = 0;
        let hypPnl = 0;
        let hypEv = 0;

        // Skip if fee > 3% or spread > 5¢
        const feeOk = roundFeeRate <= 0.03;
        const spreadOk = roundSpread <= 0.05;

        if (Math.abs(score) > 15 && conf > 20 && feeOk && spreadOk) {
          hypDecision = score > 0 ? 'BUY_UP' : 'BUY_DOWN';
          const dir = score > 0 ? 'UP' : 'DOWN';
          // Use START prices for decision, not resolved end prices
          const price = dir === 'UP' ? roundUpPriceAtStart : roundDownPriceAtStart;
          const winAmt = 1 - price;
          const loseAmt = price;
          const ourProb = Math.min(0.85, 0.5 + Math.abs(score) / 200);
          hypEv = (ourProb * winAmt) - ((1 - ourProb) * loseAmt) - roundFeeRate;

          if (hypEv > 0) {
            hypBetSize = Math.min(50 * 0.05, 2.5);
            const won = dir === result;
            hypPnl = won ? hypBetSize * (winAmt / loseAmt) - (hypBetSize * roundFeeRate) : -hypBetSize;
          } else {
            hypDecision = 'SKIP';
          }
        }

        // End time = start + 5 minutes (PM window), not detection time
        const startMs = new Date(roundStartTime).getTime();
        const roundEndTimeFixed = new Date(startMs + 300000).toISOString();

        const roundData = {
          roundStartTime,
          roundEndTime: roundEndTimeFixed,
          btcPriceStart: roundStartPrice,
          btcPriceEnd: endPrice,
          actualResult: result,
          polymarketUpPrice: roundUpPrice,
          polymarketDownPrice: roundDownPrice,
          signalOrderbook: startSignalSnapshot.signals.orderbook?.score ?? 0,
          signalEmaMacd: startSignalSnapshot.signals.ema_macd?.score ?? 0,
          signalRsiStoch: startSignalSnapshot.signals.rsi_stoch?.score ?? 0,
          signalVwapBb: startSignalSnapshot.signals.vwap_bb?.score ?? 0,
          signalCvd: startSignalSnapshot.signals.cvd?.score ?? 0,
          signalWhale: startSignalSnapshot.signals.whale?.score ?? 0,
          signalFunding: startSignalSnapshot.signals.funding?.score ?? 0,
          signalOpenInterest: startSignalSnapshot.signals.open_interest?.score ?? 0,
          signalLiquidation: startSignalSnapshot.signals.liquidation?.score ?? 0,
          signalLsRatio: startSignalSnapshot.signals.ls_ratio?.score ?? 0,
          finalScore: startSignalSnapshot.finalScore,
          confidence: startSignalSnapshot.confidence,
          hypotheticalDecision: hypDecision,
          hypotheticalEv: hypEv,
          hypotheticalBetSize: hypBetSize,
          hypotheticalPnl: hypPnl,
          polymarketFeeRate: roundFeeRate,
          orderbookSpread: roundSpread,
        };

        const savedId = saveRound(roundData);
        if (savedId) {
          roundCounter++;
          console.log(`[TrainingLoop] Round #${roundCounter}: ${result} | BTC ${roundStartPrice.toFixed(0)}→${endPrice.toFixed(0)} | PM Up:${(roundUpPrice * 100).toFixed(0)}¢ Down:${(roundDownPrice * 100).toFixed(0)}¢ | Score:${score.toFixed(1)} Conf:${conf.toFixed(1)} → ${hypDecision}`);

          // Trigger accuracy check / optimization
          onRoundRecorded();
        }
      }

      // Start tracking new round — use PM window timestamp, not detection time
      const nowMs = Date.now();
      const roundLateBy = (nowMs - round.startTime) / 1000;

      // PM2 restart guard: if we're >60s into this round, skip it
      if (roundLateBy > 60) {
        console.log(`[TrainingLoop] Skipping round ${round.slug} — joined ${roundLateBy.toFixed(0)}s late (>60s threshold)`);
        currentSlug = round.slug; // mark as seen so we don't re-process
        startSignalSnapshot = null; // no snapshot = won't save this round
        return;
      }

      currentSlug = round.slug;
      currentTokenIdUp = round.tokenIdUp;
      currentTokenIdDown = round.tokenIdDown;
      roundStartPrice = serverBinanceWS.lastTradePrice;
      roundUpPrice = round.priceUp;
      roundDownPrice = round.priceDown;
      // Snapshot prices at round start — for hypothetical decision calc
      // (roundUpPrice/roundDownPrice get updated during round via CLOB poll)
      roundUpPriceAtStart = round.priceUp;
      roundDownPriceAtStart = round.priceDown;
      // Use PM window start, not polling detection time
      roundStartTime = new Date(round.startTime).toISOString();
      startSignalSnapshot = serverSignalEngine.getLastSignal();

      // Calculate fee from price, fetch spread
      roundFeeRate = polymarketClient.calculateFee(round.priceUp);
      roundSpread = 0.02; // default
      try {
        roundSpread = await polymarketClient.getSpread(round.tokenIdUp, round.tokenIdDown);
      } catch { /* use default */ }

      console.log(`[TrainingLoop] Tracking: ${round.title} | Up:${(roundUpPrice * 100).toFixed(1)}¢ Down:${(roundDownPrice * 100).toFixed(1)}¢ | Fee:${(roundFeeRate * 100).toFixed(1)}% Spread:${(roundSpread * 100).toFixed(1)}¢ | Late:${roundLateBy.toFixed(0)}s`);
    } else {
      // Same round — update prices from CLOB midpoint
      if (round.tokenIdUp && round.tokenIdDown) {
        const prices = await refreshPrices(round.tokenIdUp, round.tokenIdDown, round.slug);
        if (prices) {
          roundUpPrice = prices.priceUp;
          roundDownPrice = prices.priceDown;
        }
      }
    }
  } catch (err) {
    console.error(`[TrainingLoop] Poll error: ${err}`);
  }
}

export const serverTrainingLoop = {
  getRoundCount(): number {
    return roundCounter;
  },

  getCurrentSlug(): string {
    return currentSlug;
  },

  getTrackingState() {
    return {
      currentSlug,
      roundStartPrice,
      roundUpPrice,
      roundDownPrice,
      roundStartTime,
      roundCounter: getRoundCountFromDB(),
      hasSignalSnapshot: !!startSignalSnapshot,
      roundsSinceLastAccuracyCheck,
      roundsSinceLastOptimize,
      feeRate: roundFeeRate,
      spread: roundSpread,
    };
  },

  getLastAccuracies(): SignalAccuracy[] {
    return [...lastAccuracies];
  },

  // Manual trigger for accuracy check
  async runAccuracyNow(): Promise<void> {
    roundsSinceLastAccuracyCheck = 0;
    await runAccuracyCheck();
  },

  // Manual trigger for full optimization — force run with enough rounds
  async runOptimizationNow(): Promise<void> {
    roundsSinceLastOptimize = 999; // Force past all thresholds
    await runFullOptimization();
    roundsSinceLastOptimize = 0;
  },

  async start(): Promise<void> {
    // Refresh count from DB
    roundCounter = getRoundCountFromDB();
    console.log(`[TrainingLoop] Loaded ${roundCounter} existing training rounds`);

    // Wait a few seconds for signals to warm up
    console.log('[TrainingLoop] Waiting 15s for signal warmup...');
    await new Promise(resolve => setTimeout(resolve, 15000));

    // Start polling every 10 seconds
    console.log('[TrainingLoop] Starting round polling (10s interval)');
    pollRound();
    trainingInterval = setInterval(pollRound, 10000);
  },

  stop() {
    if (trainingInterval) {
      clearInterval(trainingInterval);
      trainingInterval = null;
    }
    console.log('[TrainingLoop] Training loop stopped');
  },
};

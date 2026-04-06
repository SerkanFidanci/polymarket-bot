import { serverBinanceWS } from './binance-ws.js';
import { serverSignalEngine } from './signal-engine.js';
import { polymarketClient } from './polymarket/client.js';
import { db } from './db/sqlite.js';
import type { CombinedSignal } from '../src/types/index.js';

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

// Round tracking state
let currentSlug = '';
let roundStartPrice = 0;
let roundUpPrice = 0;
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
      return existing.id;
    }

    const stmt = db.prepare(`
      INSERT INTO training_rounds (
        round_start_time, round_end_time, btc_price_start, btc_price_end,
        actual_result, polymarket_up_price, polymarket_down_price,
        signal_orderbook, signal_ema_macd, signal_rsi_stoch, signal_vwap_bb,
        signal_cvd, signal_whale, signal_funding, signal_open_interest,
        signal_liquidation, signal_ls_ratio, final_score, confidence,
        hypothetical_decision, hypothetical_ev, hypothetical_bet_size, hypothetical_pnl
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

        // Calculate hypothetical decision
        const score = startSignalSnapshot.finalScore;
        const conf = startSignalSnapshot.confidence;
        let hypDecision = 'SKIP';
        let hypBetSize = 0;
        let hypPnl = 0;
        if (Math.abs(score) > 15 && conf > 30) {
          hypDecision = score > 0 ? 'BUY_UP' : 'BUY_DOWN';
          const dir = score > 0 ? 'UP' : 'DOWN';
          const price = dir === 'UP' ? roundUpPrice : roundDownPrice;
          hypBetSize = Math.min(50 * 0.05, 5);
          const won = dir === result;
          hypPnl = won ? hypBetSize * ((1 - price) / price) : -hypBetSize;
        }

        const roundData = {
          roundStartTime,
          roundEndTime: new Date().toISOString(),
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
          hypotheticalEv: 0,
          hypotheticalBetSize: hypBetSize,
          hypotheticalPnl: hypPnl,
        };

        const savedId = saveRound(roundData);
        if (savedId) {
          roundCounter++;
          console.log(`[TrainingLoop] Round #${roundCounter}: ${result} | BTC ${roundStartPrice.toFixed(0)}→${endPrice.toFixed(0)} | PM Up:${(roundUpPrice * 100).toFixed(0)}¢ Down:${(roundDownPrice * 100).toFixed(0)}¢ | Score:${score.toFixed(1)} Conf:${conf.toFixed(1)} → ${hypDecision}`);
        }
      }

      // Start tracking new round
      currentSlug = round.slug;
      roundStartPrice = serverBinanceWS.lastTradePrice;
      roundUpPrice = round.priceUp;
      roundDownPrice = round.priceDown;
      roundStartTime = new Date().toISOString();
      startSignalSnapshot = serverSignalEngine.getLastSignal();

      console.log(`[TrainingLoop] Tracking: ${round.title} | Up:${(roundUpPrice * 100).toFixed(1)}¢ Down:${(roundDownPrice * 100).toFixed(1)}¢`);
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
      roundCounter,
      hasSignalSnapshot: !!startSignalSnapshot,
    };
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

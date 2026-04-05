import { binanceWS } from './BinanceWS.js';
import { logger } from '../utils/logger.js';
import { BINANCE_FUTURES_API, FUTURES_REST_POLL_INTERVAL } from '../utils/constants.js';
import type { FuturesData } from '../types/index.js';

const defaultFuturesData: FuturesData = {
  fundingRate: 0,
  fundingRatePrev: 0,
  openInterest: 0,
  openInterestPrev: 0,
  globalLongShortRatio: 1,
  topLongShortRatio: 1,
  takerBuySellRatio: 1,
  markPrice: 0,
  lastUpdate: 0,
};

let futuresData: FuturesData = { ...defaultFuturesData };
let pollInterval: ReturnType<typeof setInterval> | null = null;
let listeners: ((data: FuturesData) => void)[] = [];
let prevLS = 0;

async function fetchJSON(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function pollFuturesData(): Promise<void> {
  try {
    const [oiRes, fundingRes, globalLSRes, topLSRes, takerRes] = await Promise.allSettled([
      fetchJSON(`${BINANCE_FUTURES_API}/fapi/v1/openInterest?symbol=BTCUSDT`),
      fetchJSON(`${BINANCE_FUTURES_API}/fapi/v1/fundingRate?symbol=BTCUSDT&limit=2`),
      fetchJSON(`${BINANCE_FUTURES_API}/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1`),
      fetchJSON(`${BINANCE_FUTURES_API}/futures/data/topLongShortPositionRatio?symbol=BTCUSDT&period=5m&limit=1`),
      fetchJSON(`${BINANCE_FUTURES_API}/futures/data/takerlongshortRatio?symbol=BTCUSDT&period=5m&limit=1`),
    ]);

    const prevOI = futuresData.openInterest;
    const prevFunding = futuresData.fundingRate;

    if (oiRes.status === 'fulfilled') {
      const oi = oiRes.value as { openInterest: string };
      futuresData.openInterest = parseFloat(oi.openInterest);
      futuresData.openInterestPrev = prevOI || futuresData.openInterest;
    }

    if (fundingRes.status === 'fulfilled') {
      const rates = fundingRes.value as { fundingRate: string }[];
      if (rates.length >= 2) {
        futuresData.fundingRate = parseFloat(rates[rates.length - 1]!.fundingRate);
        futuresData.fundingRatePrev = parseFloat(rates[rates.length - 2]!.fundingRate);
      } else if (rates.length === 1) {
        futuresData.fundingRate = parseFloat(rates[0]!.fundingRate);
        futuresData.fundingRatePrev = prevFunding;
      }
    }

    if (globalLSRes.status === 'fulfilled') {
      const ls = (globalLSRes.value as { longShortRatio: string }[]);
      if (ls[0]) futuresData.globalLongShortRatio = parseFloat(ls[0].longShortRatio);
    }

    if (topLSRes.status === 'fulfilled') {
      const ls = (topLSRes.value as { longShortRatio: string }[]);
      if (ls[0]) futuresData.topLongShortRatio = parseFloat(ls[0].longShortRatio);
    }

    if (takerRes.status === 'fulfilled') {
      const ratio = (takerRes.value as { buySellRatio: string }[]);
      if (ratio[0]) futuresData.takerBuySellRatio = parseFloat(ratio[0].buySellRatio);
    }

    futuresData.markPrice = binanceWS.markPrice || futuresData.markPrice;
    futuresData.lastUpdate = Date.now();

    for (const listener of listeners) listener(futuresData);

    // Only log when significant changes occur
    const oiChange = prevOI > 0 ? Math.abs(futuresData.openInterest - prevOI) / prevOI : 1;
    const fundingChanged = Math.abs(futuresData.fundingRate - prevFunding) > 0.000001;
    const lsChanged = Math.abs(futuresData.globalLongShortRatio - prevLS) > 0.05;
    if (oiChange > 0.001 || fundingChanged || lsChanged) {
      logger.debug('StreamManager', `Futures: OI:${futuresData.openInterest.toFixed(0)} Fund:${(futuresData.fundingRate * 100).toFixed(4)}% L/S:${futuresData.globalLongShortRatio.toFixed(2)}`);
      prevLS = futuresData.globalLongShortRatio;
    }
  } catch (err) {
    logger.error('StreamManager', `Futures polling error: ${err}`);
  }
}

export const streamManager = {
  getFuturesData(): FuturesData {
    return { ...futuresData };
  },

  onFuturesUpdate(listener: (data: FuturesData) => void) {
    listeners.push(listener);
    return () => {
      listeners = listeners.filter(l => l !== listener);
    };
  },

  async start(): Promise<void> {
    logger.info('StreamManager', 'Starting stream manager...');
    await binanceWS.connect();

    // Pre-load historical klines if empty (needed for EMA, RSI, MACD, BB, VWAP)
    if (binanceWS.klines.length < 10) {
      try {
        const res = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=60');
        if (res.ok) {
          const data = await res.json() as (string | number)[][];
          const klines = data.map(k => ({
            openTime: k[0] as number,
            open: parseFloat(k[1] as string),
            high: parseFloat(k[2] as string),
            low: parseFloat(k[3] as string),
            close: parseFloat(k[4] as string),
            volume: parseFloat(k[5] as string),
            closeTime: k[6] as number,
          }));
          // Inject into binanceWS via public setter
          (binanceWS as unknown as { _klines: typeof klines })._klines = klines;
          logger.info('StreamManager', `Pre-loaded ${klines.length} historical 1m candles`);
        }
      } catch (err) {
        logger.warn('StreamManager', `Failed to fetch historical klines: ${err}`);
      }
    }

    // Initial futures data fetch
    await pollFuturesData();

    // Start polling
    pollInterval = setInterval(pollFuturesData, FUTURES_REST_POLL_INTERVAL);
    logger.info('StreamManager', `Futures REST polling every ${FUTURES_REST_POLL_INTERVAL / 1000}s`);
  },

  stop() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    binanceWS.disconnect();
    logger.info('StreamManager', 'Stream manager stopped');
  },
};

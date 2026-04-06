import { serverBinanceWS } from './binance-ws.js';
import type { FuturesData } from '../src/types/index.js';

const BINANCE_FUTURES_API = 'https://fapi.binance.com';
const FUTURES_REST_POLL_INTERVAL = 15000;

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

    futuresData.markPrice = serverBinanceWS.markPrice || futuresData.markPrice;
    futuresData.lastUpdate = Date.now();

    // Only log when significant changes occur
    const oiChange = prevOI > 0 ? Math.abs(futuresData.openInterest - prevOI) / prevOI : 1;
    const fundingChanged = Math.abs(futuresData.fundingRate - prevFunding) > 0.000001;
    const lsChanged = Math.abs(futuresData.globalLongShortRatio - prevLS) > 0.05;
    if (oiChange > 0.001 || fundingChanged || lsChanged) {
      console.log(`[ServerStreamManager] Futures: OI:${futuresData.openInterest.toFixed(0)} Fund:${(futuresData.fundingRate * 100).toFixed(4)}% L/S:${futuresData.globalLongShortRatio.toFixed(2)}`);
      prevLS = futuresData.globalLongShortRatio;
    }
  } catch (err) {
    console.error(`[ServerStreamManager] Futures polling error: ${err}`);
  }
}

export const serverStreamManager = {
  getFuturesData(): FuturesData {
    return { ...futuresData };
  },

  async start(): Promise<void> {
    console.log('[ServerStreamManager] Starting server stream manager...');
    await serverBinanceWS.connect();

    // Initial futures data fetch
    await pollFuturesData();

    // Start polling
    pollInterval = setInterval(pollFuturesData, FUTURES_REST_POLL_INTERVAL);
    console.log(`[ServerStreamManager] Futures REST polling every ${FUTURES_REST_POLL_INTERVAL / 1000}s`);
  },

  stop() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    serverBinanceWS.disconnect();
    console.log('[ServerStreamManager] Server stream manager stopped');
  },
};

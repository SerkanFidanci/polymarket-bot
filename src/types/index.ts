export * from './signals.js';
export * from './trading.js';
export * from './bankroll.js';

export interface OrderBookEntry {
  price: number;
  quantity: number;
}

export interface OrderBook {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  timestamp: number;
}

export interface Trade {
  price: number;
  quantity: number;
  isBuyerMaker: boolean;
  timestamp: number;
}

export interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export interface FuturesData {
  fundingRate: number;
  fundingRatePrev: number;
  openInterest: number;
  openInterestPrev: number;
  globalLongShortRatio: number;
  topLongShortRatio: number;
  takerBuySellRatio: number;
  markPrice: number;
  lastUpdate: number;
}

export interface LiquidationEvent {
  symbol: string;
  side: 'BUY' | 'SELL';  // BUY = short liq, SELL = long liq
  price: number;
  quantity: number;
  timestamp: number;
}

export interface MarketData {
  price: number;
  orderBook: OrderBook;
  trades: Trade[];
  klines: Kline[];
  futuresData: FuturesData;
  liquidations: LiquidationEvent[];
  timestamp: number;
}

export interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'TRADE';
  source: string;
  message: string;
}

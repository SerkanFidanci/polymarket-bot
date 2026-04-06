// Binance WebSocket URLs
export const BINANCE_WS_SPOT = 'wss://stream.binance.com:9443/stream?streams=';
export const BINANCE_WS_FUTURES = 'wss://fstream.binance.com/stream?streams=';

// Binance REST API
export const BINANCE_FUTURES_API = 'https://fapi.binance.com';

// Binance streams
export const SPOT_STREAMS = [
  'btcusdt@trade',
  'btcusdt@depth20@100ms',
  'btcusdt@kline_1m',
  'btcusdt@aggTrade',
];

export const FUTURES_STREAMS = [
  'btcusdt@markPrice@1s',
  'btcusdt@forceOrder',
];

// Polling intervals (ms)
export const FUTURES_REST_POLL_INTERVAL = 15000;
export const MARKET_POLL_INTERVAL = 5000;
export const BALANCE_POLL_INTERVAL = 30000;

// WebSocket reconnect
export const WS_RECONNECT_ATTEMPTS = 3;
export const WS_RECONNECT_DELAY = 2000;

// Data buffers
export const MAX_TRADES_BUFFER = 5000;
export const MAX_KLINES_BUFFER = 100;
export const MAX_LIQUIDATIONS_BUFFER = 500;

// Trading timing (seconds)
export const ROUND_DURATION = 300;
export const ENTRY_WINDOW_START = 30;
export const ENTRY_WINDOW_END = 270;
export const IDEAL_ENTRY_START = 30;
export const IDEAL_ENTRY_END = 90;

// Signal thresholds
export const MIN_CONFIDENCE_DEFAULT = 30;
export const MIN_SCORE_DEFAULT = 15;
export const WHALE_THRESHOLD_BTC = 0.5;

// Training
export const MIN_ROUNDS_FOR_PAPER = 200;
export const MIN_PAPER_TRADES_FOR_LIVE = 200;
export const MIN_PAPER_WIN_RATE = 0.55;
export const MAX_PAPER_DRAWDOWN = 0.30;
export const MIN_SIGNAL_ACCURACY = 0.50;
export const OPTIMIZE_EVERY_N_ROUNDS = 100;
export const EDGE_OPTIMIZE_EVERY_N_ROUNDS = 200;
export const FULL_OPTIMIZE_EVERY_N_ROUNDS = 500;

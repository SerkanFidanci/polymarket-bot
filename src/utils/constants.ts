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

// ===== EXIT STRATEGY =====
export const EXIT_CHECK_INTERVAL = 500;           // Check exits every 500ms
export const STOP_LOSS_PCT = 0.50;                 // Exit if token drops to 50% of entry
export const TAKE_PROFIT_PCT = 1.80;               // Exit if token rises to 180% of entry
export const ABSOLUTE_STOP = 0.15;                 // Exit if token < 15¢ (recovery impossible)
export const ABSOLUTE_TARGET = 0.85;               // Exit if token > 85¢ (nearly won)
export const TREND_REVERSAL_BTC_PCT = 0.001;       // 0.1% BTC move against position in 30s
export const TREND_REVERSAL_DURATION_MS = 30000;   // 30 seconds lookback
export const SIGNAL_FLIP_THRESHOLD = 10;           // Exit if signal score flips > 10 against
export const TIME_EXIT_60S_MIN = 0.30;             // With 60s left, exit if token < 30¢
export const TIME_EXIT_60S_MAX = 0.70;             // With 60s left, exit if token in 30-70¢
export const TIME_EXIT_30S_MIN = 0.80;             // With 30s left, exit if token < 80¢
export const VOLATILITY_SPIKE_BTC_PCT = 0.003;     // 0.3% BTC move in 30s = volatility spike
export const TRAILING_STOP_PCT = 0.20;             // Trailing stop: 20% from peak

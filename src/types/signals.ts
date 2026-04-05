export interface SignalResult {
  name: string;
  score: number;       // -100 to +100
  confidence: number;  // 0 to 100
  timestamp: number;
  details: Record<string, number | string | boolean>;
}

export type SignalName =
  | 'orderbook'
  | 'ema_macd'
  | 'rsi_stoch'
  | 'vwap_bb'
  | 'cvd'
  | 'whale'
  | 'funding'
  | 'open_interest'
  | 'liquidation'
  | 'ls_ratio';

export type SignalGroup = 'price_action' | 'order_flow' | 'derivative' | 'sentiment';

export const SIGNAL_GROUPS: Record<SignalGroup, SignalName[]> = {
  price_action: ['orderbook', 'ema_macd', 'rsi_stoch', 'vwap_bb'],
  order_flow: ['cvd', 'whale'],
  derivative: ['funding', 'open_interest', 'liquidation'],
  sentiment: ['ls_ratio'],
};

export const DEFAULT_WEIGHTS: Record<SignalName, number> = {
  orderbook: 0.10,
  ema_macd: 0.10,
  rsi_stoch: 0.10,
  vwap_bb: 0.10,
  cvd: 0.12,
  whale: 0.10,
  funding: 0.08,
  open_interest: 0.08,
  liquidation: 0.08,
  ls_ratio: 0.14,
};

export interface SignalWeights extends Record<SignalName, number> {}

export interface CombinedSignal {
  finalScore: number;
  confidence: number;
  signals: Record<SignalName, SignalResult>;
  groupScores: Record<SignalGroup, number>;
  allGroupsAgree: boolean;
  timestamp: number;
}

export interface SignalAccuracy {
  signalName: SignalName;
  accuracy: number;
  totalPredictions: number;
  correct: number;
  incorrect: number;
  abstainRate: number;
  edgeOverRandom: number;
  status: 'ACTIVE' | 'WARNING' | 'DISABLED';
}

export type TradingMode = 'passive' | 'paper' | 'live';
export type Direction = 'UP' | 'DOWN';
export type DecisionAction = 'BUY_UP' | 'BUY_DOWN' | 'SKIP' | 'STOP';
export type BetResult = 'WIN' | 'LOSS' | 'PENDING';

export type SystemStatus =
  | 'INITIALIZING'
  | 'WARMING_UP'
  | 'RUNNING'
  | 'PAUSED'
  | 'STOPPED'
  | 'ERROR'
  | 'MARKET_UNAVAILABLE';

export interface Decision {
  action: DecisionAction;
  direction?: Direction;
  betSize?: number;
  ev?: number;
  confidence?: number;
  score?: number;
  ourProbability?: number;
  kellyFraction?: number;
  reason: string;
  timestamp: number;
}

export interface Bet {
  id?: number;
  timestamp: string;
  roundId: string;
  marketId: string;
  direction: Direction;
  entryPrice: number;
  betSize: number;
  contracts: number;
  finalScore: number;
  confidence: number;
  ev: number;
  ourProbability: number;
  signalScores: Record<string, number>;
  result?: BetResult;
  pnl?: number;
  bankrollAfter?: number;
  polymarketOrderId?: string;
  notes?: string;
}

export interface Round {
  id: string;
  marketId: string;
  tokenIdUp: string;
  tokenIdDown: string;
  priceUp: number;
  priceDown: number;
  startTime: number;
  endTime: number;
  result?: Direction;
}

export interface TrainingRound {
  id?: number;
  roundStartTime: string;
  roundEndTime: string;
  btcPriceStart: number;
  btcPriceEnd: number;
  actualResult: Direction;
  polymarketUpPrice: number;
  polymarketDownPrice: number;
  signalScores: Record<string, number>;
  finalScore: number;
  confidence: number;
  hypotheticalDecision: DecisionAction;
  hypotheticalEv: number;
  hypotheticalBetSize: number;
  hypotheticalPnl: number;
}

export interface PaperTrade {
  id?: number;
  roundId: number;
  bankrollBefore: number;
  direction: Direction;
  betSize: number;
  entryPrice: number;
  result?: BetResult;
  pnl?: number;
  bankrollAfter?: number;
  weightsUsed: string;
  thresholdConfigUsed: string;
}

export interface DailyStats {
  date: string;
  startingBalance: number;
  endingBalance: number;
  totalBets: number;
  wins: number;
  losses: number;
  skips: number;
  pnl: number;
  bestBet: number;
  worstBet: number;
}

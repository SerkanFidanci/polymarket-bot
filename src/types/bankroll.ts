export interface BankrollState {
  balance: number;
  initialBalance: number;
  dailyStartBalance: number;
  dailyPnl: number;
  totalPnl: number;
  totalBets: number;
  wins: number;
  losses: number;
  consecutiveWins: number;
  consecutiveLosses: number;
  maxDrawdown: number;
  peakBalance: number;
  lastBetTime: string | null;
}

export interface RiskConfig {
  kellyFraction: number;
  minBet: number;
  maxBetPercent: number;
  dailyLossLimit: number;
  dailyProfitTarget: number;
  systemStopLoss: number;
  tiltLevel1: number;
  tiltLevel2: number;
  tiltLevel3: number;
  extremeOddsMin: number;
  extremeOddsMax: number;
  coldStartWarmup: number;
  staleDataThreshold: number;
  highVolatilityThreshold: number;
  usdcDepegThreshold: number;
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  kellyFraction: 0.5,
  minBet: 1,
  maxBetPercent: 0.15,
  dailyLossLimit: 0.20,
  dailyProfitTarget: 0.40,
  systemStopLoss: 0.75,
  tiltLevel1: 3,
  tiltLevel2: 5,
  tiltLevel3: 8,
  extremeOddsMin: 0.10,
  extremeOddsMax: 0.90,
  coldStartWarmup: 900,
  staleDataThreshold: 2000,
  highVolatilityThreshold: 0.005,
  usdcDepegThreshold: 0.97,
};

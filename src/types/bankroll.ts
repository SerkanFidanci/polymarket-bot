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
  kellyFraction: number;         // Base Kelly fraction
  kellyFractionAggressive: number; // For extreme price zones (0-0.25 or 0.75-1.00)
  kellyFractionConservative: number; // For uncertain zone (0.40-0.60)
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
  maxSpread: number;             // Max spread to enter (skip if higher)
  maxFeeRate: number;            // Max fee rate to enter (skip if higher)
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  kellyFraction: 0.25,              // Quarter Kelly (was 0.5)
  kellyFractionAggressive: 0.40,    // Near-extreme prices: higher Kelly
  kellyFractionConservative: 0.15,  // Uncertain zone: lower Kelly
  minBet: 1,
  maxBetPercent: 0.10,              // Max 10% of bankroll per bet
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
  maxSpread: 0.05,                  // Skip if spread > 5¢
  maxFeeRate: 0.03,                 // Skip if fee > 3%
};

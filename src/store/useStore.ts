import { create } from 'zustand';
import type { CombinedSignal, SystemStatus, TradingMode, Decision, LogEntry, DailyStats, BankrollState } from '../types/index.js';
import { DEFAULT_WEIGHTS } from '../types/signals.js';
import type { SignalWeights, SignalAccuracy } from '../types/signals.js';
import type { PhaseStatus } from '../engine/PhaseController.js';

interface OptimizationEntry {
  timestamp: string;
  type: string;
  roundsAnalyzed: number;
  improvement: number;
  applied: boolean;
  reason: string;
}

interface AppState {
  // System
  systemStatus: SystemStatus;
  tradingMode: TradingMode;
  warmupStartTime: number | null;
  uptime: number;

  // Price
  btcPrice: number;
  btcPriceChange: number;
  priceHistory: number[];

  // Signals
  currentSignal: CombinedSignal | null;
  signalWeights: SignalWeights;

  // Decisions
  lastDecision: Decision | null;
  decisionHistory: Decision[];

  // Bankroll
  bankroll: BankrollState;

  // Training
  trainingRoundsCount: number;
  paperTradesCount: number;
  signalAccuracies: SignalAccuracy[];
  proposedWeights: SignalWeights | null;
  phaseStatus: PhaseStatus | null;
  optimizationHistory: OptimizationEntry[];
  dailyReports: Array<Record<string, unknown>>;

  // Polymarket round (single source of truth)
  polyRound: {
    slug: string;
    title: string;
    priceUp: number;
    priceDown: number;
    endTime: number;
    acceptingOrders: boolean;
    tokenIdUp: string;
    tokenIdDown: string;
  } | null;

  // UI
  logs: LogEntry[];
  dailyStats: DailyStats[];
  isConnected: boolean;
  isFuturesConnected: boolean;

  // Actions
  setPolyRound: (round: AppState['polyRound']) => void;
  updatePolyPrices: (priceUp: number, priceDown: number) => void;
  setBtcPrice: (price: number) => void;
  setCurrentSignal: (signal: CombinedSignal) => void;
  setLastDecision: (decision: Decision) => void;
  setSystemStatus: (status: SystemStatus) => void;
  setTradingMode: (mode: TradingMode) => void;
  setConnected: (connected: boolean) => void;
  setFuturesConnected: (connected: boolean) => void;
  addLog: (log: LogEntry) => void;
  setTrainingRoundsCount: (count: number) => void;
  setPaperTradesCount: (count: number) => void;
  setBankroll: (bankroll: Partial<BankrollState>) => void;
  setDailyStats: (stats: DailyStats[]) => void;
  setSignalWeights: (weights: SignalWeights) => void;
  setWarmupStartTime: (time: number | null) => void;
  setSignalAccuracies: (accuracies: SignalAccuracy[]) => void;
  setProposedWeights: (weights: SignalWeights | null) => void;
  setPhaseStatus: (status: PhaseStatus | null) => void;
  addOptimizationEntry: (entry: OptimizationEntry) => void;
  setDailyReports: (reports: Array<Record<string, unknown>>) => void;
}

export const useStore = create<AppState>((set) => ({
  // System
  systemStatus: 'INITIALIZING',
  tradingMode: 'passive',
  warmupStartTime: null,
  uptime: 0,

  // Price
  btcPrice: 0,
  btcPriceChange: 0,
  priceHistory: [],

  // Signals
  currentSignal: null,
  signalWeights: { ...DEFAULT_WEIGHTS },

  // Decisions
  lastDecision: null,
  decisionHistory: [],

  // Bankroll
  bankroll: {
    balance: 50,
    initialBalance: 50,
    dailyStartBalance: 50,
    dailyPnl: 0,
    totalPnl: 0,
    totalBets: 0,
    wins: 0,
    losses: 0,
    consecutiveWins: 0,
    consecutiveLosses: 0,
    maxDrawdown: 0,
    peakBalance: 50,
    lastBetTime: null,
  },

  // Training
  trainingRoundsCount: 0,
  paperTradesCount: 0,
  signalAccuracies: [],
  proposedWeights: null,
  phaseStatus: null,
  optimizationHistory: [],
  dailyReports: [],

  // Polymarket
  polyRound: null,

  // UI
  logs: [],
  dailyStats: [],
  isConnected: false,
  isFuturesConnected: false,

  // Actions
  setPolyRound: (round) => set({ polyRound: round }),
  updatePolyPrices: (priceUp, priceDown) => set((s) => ({
    polyRound: s.polyRound ? { ...s.polyRound, priceUp, priceDown } : null,
  })),
  setBtcPrice: (price) => set((s) => ({
    btcPrice: price,
    btcPriceChange: s.btcPrice > 0 ? ((price - s.btcPrice) / s.btcPrice) * 100 : 0,
    priceHistory: [...s.priceHistory.slice(-299), price],
  })),

  setCurrentSignal: (signal) => set({ currentSignal: signal }),

  setLastDecision: (decision) => set((s) => ({
    lastDecision: decision,
    decisionHistory: [...s.decisionHistory.slice(-49), decision],
  })),

  setSystemStatus: (status) => set({ systemStatus: status }),
  setTradingMode: (mode) => set({ tradingMode: mode }),
  setConnected: (connected) => set({ isConnected: connected }),
  setFuturesConnected: (connected) => set({ isFuturesConnected: connected }),

  addLog: (log) => set((s) => ({
    logs: [...s.logs.slice(-199), log],
  })),

  setTrainingRoundsCount: (count) => set({ trainingRoundsCount: count }),
  setPaperTradesCount: (count) => set({ paperTradesCount: count }),

  setBankroll: (bankroll) => set((s) => ({
    bankroll: { ...s.bankroll, ...bankroll },
  })),

  setDailyStats: (stats) => set({ dailyStats: stats }),
  setSignalWeights: (weights) => set({ signalWeights: weights }),
  setWarmupStartTime: (time) => set({ warmupStartTime: time }),
  setSignalAccuracies: (accuracies) => set({ signalAccuracies: accuracies }),
  setProposedWeights: (weights) => set({ proposedWeights: weights }),
  setPhaseStatus: (status) => set({ phaseStatus: status }),
  addOptimizationEntry: (entry) => set((s) => ({
    optimizationHistory: [...s.optimizationHistory.slice(-19), entry],
  })),
  setDailyReports: (reports) => set({ dailyReports: reports }),
}));

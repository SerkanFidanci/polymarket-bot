import { useEffect, useRef } from 'react';
import { useStore } from './store/useStore';
import { startBot } from './engine/BotEngine';
import { SystemStatusBar } from './components/SystemStatusBar';
import { CandlestickChart } from './components/CandlestickChart';
import { PolymarketPanel } from './components/PolymarketPanel';
import { DecisionBanner } from './components/DecisionBanner';
import { SignalCard } from './components/SignalCard';
import { SignalGauge } from './components/SignalGauge';
import { BankrollDashboard } from './components/BankrollDashboard';
import { PaperTrading } from './components/PaperTrading';
import { LogFeed } from './components/LogFeed';
import { TrainingPanel } from './components/TrainingPanel';
import { TradeHistory } from './components/TradeHistory';
import type { SignalName } from './types/signals';

const GROUP_A: SignalName[] = ['orderbook', 'ema_macd', 'rsi_stoch', 'vwap_bb'];
const GROUP_B: SignalName[] = ['cvd', 'whale'];
const GROUP_C: SignalName[] = ['funding', 'open_interest', 'liquidation'];
const GROUP_D: SignalName[] = ['ls_ratio'];

const GROUP_LABELS = [
  { label: 'A — Price Action', signals: GROUP_A, color: '#42a5f5' },
  { label: 'B — Order Flow', signals: GROUP_B, color: '#ab47bc' },
  { label: 'C — Derivatives', signals: GROUP_C, color: '#ff9800' },
  { label: 'D — Sentiment', signals: GROUP_D, color: '#26c6da' },
];

function App() {
  const store = useStore();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const s = useStore.getState();
    startBot({
      setBtcPrice: s.setBtcPrice,
      setCurrentSignal: s.setCurrentSignal,
      setSystemStatus: s.setSystemStatus as (s: string) => void,
      setConnected: s.setConnected,
      setFuturesConnected: s.setFuturesConnected,
      addLog: s.addLog,
      setWarmupStartTime: s.setWarmupStartTime,
      setTrainingRoundsCount: s.setTrainingRoundsCount,
      setLastDecision: s.setLastDecision,
      setBankroll: s.setBankroll as (b: Record<string, unknown>) => void,
      setTradingMode: s.setTradingMode as (m: string) => void,
      setSignalAccuracies: s.setSignalAccuracies,
      setProposedWeights: s.setProposedWeights,
      setPhaseStatus: s.setPhaseStatus,
      setSignalWeights: s.setSignalWeights,
      addOptimizationEntry: s.addOptimizationEntry as unknown as (e: Record<string, unknown>) => void,
    });
  }, []);

  const { currentSignal, signalWeights, signalAccuracies } = store;
  const accMap = new Map(signalAccuracies.map(a => [a.signalName, a.accuracy]));

  return (
    <div className="min-h-screen bg-[var(--color-bg)] overflow-x-hidden">
      <SystemStatusBar />

      <div className="max-w-[1440px] mx-auto p-3 space-y-3">
        {/* Row 1: Decision Banner */}
        <DecisionBanner />

        {/* Row 2: Chart + Right Sidebar */}
        <div className="flex flex-col lg:flex-row gap-3">
          {/* Chart — takes remaining space */}
          <div className="flex-1 min-w-0">
            <CandlestickChart />
          </div>
          {/* Right sidebar — fixed width */}
          <div className="w-full lg:w-[320px] lg:shrink-0 flex flex-col gap-3">
            <PolymarketPanel />
            <PaperTrading />
            <SignalGauge />
          </div>
        </div>

        {/* Row 3: All signals in one grid */}
        <div className="space-y-2">
          {GROUP_LABELS.map(({ label, signals, color }) => (
            <div key={label}>
              <div className="text-[10px] uppercase tracking-wider mb-1.5 font-semibold" style={{ color }}>{label}</div>
              <div className={`grid gap-2 ${signals.length === 1 ? 'grid-cols-1 sm:grid-cols-2' : signals.length <= 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'}`}>
                {signals.map((name) => {
                  const signal = currentSignal?.signals[name] ?? {
                    name, score: 0, confidence: 0, timestamp: 0, details: {},
                  };
                  return (
                    <SignalCard
                      key={name}
                      signal={signal}
                      weight={signalWeights[name]}
                      accuracy={accMap.get(name)}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Row 4: Trade History + Bankroll + Logs */}
        <TradeHistory />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <BankrollDashboard />
          <LogFeed />
        </div>

        {/* Row 5: Training Panel */}
        <TrainingPanel />
      </div>
    </div>
  );
}

export default App;

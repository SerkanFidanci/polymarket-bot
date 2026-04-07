import { useEffect } from 'react';
import { useApiData } from './hooks/useApiData';
import { StatusBar } from './components/StatusBar';
import { PolymarketPanel } from './components/PolymarketPanel';
import { BtcChart } from './components/BtcChart';
import { SignalPanel } from './components/SignalPanel';
import { StrategyLeaderboard } from './components/StrategyLeaderboard';
import { TradeHistory } from './components/TradeHistory';

function App() {
  const { live, round, strategies, allStratTrades, fetchStratTrades } = useApiData();

  // Load all trades on mount
  useEffect(() => { fetchStratTrades('ALL'); }, [fetchStratTrades]);

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      {/* 1. Status Bar */}
      <StatusBar data={live} />

      {/* Main Content */}
      <div className="max-w-[1440px] mx-auto p-3 space-y-3">
        {/* Top Row: PM Panel + Chart + Signals */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          {/* Left: PM Panel */}
          <div className="lg:col-span-3 flex flex-col gap-3">
            <PolymarketPanel round={round} live={live} />
            <SignalPanel data={live} />
          </div>

          {/* Center: Chart */}
          <div className="lg:col-span-6">
            <BtcChart />
          </div>

          {/* Right: Strategy Leaderboard */}
          <div className="lg:col-span-3">
            <StrategyLeaderboard
              strategies={strategies}
              onSelect={(name) => fetchStratTrades(name)}
            />
          </div>
        </div>

        {/* Bottom: Trade History */}
        <TradeHistory
          trades={allStratTrades}
          onFilterChange={(name) => fetchStratTrades(name)}
        />
      </div>
    </div>
  );
}

export default App;

import { useState, useEffect } from 'react';
import { useApiData } from './hooks/useApiData';
import { StatusBar } from './components/StatusBar';
import { PolymarketPanel } from './components/PolymarketPanel';
import { BtcChart } from './components/BtcChart';
import { SignalPanel } from './components/SignalPanel';
import { StrategyLeaderboard } from './components/StrategyLeaderboard';
import { TradeHistory } from './components/TradeHistory';
import { TradeLog } from './components/TradeLog';

function App() {
  const { live, round, strategies, allStratTrades, fetchStratTrades } = useApiData();
  const [tab, setTab] = useState<'dashboard' | 'trades'>('dashboard');

  useEffect(() => { fetchStratTrades('ALL'); }, [fetchStratTrades]);

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <StatusBar data={live} />

      {/* Tab Navigation */}
      <div className="max-w-[1440px] mx-auto px-2 pt-2">
        <div className="flex gap-1">
          <button onClick={() => setTab('dashboard')}
            className={`px-4 py-1.5 rounded-t text-xs mono font-medium transition-colors ${tab === 'dashboard' ? 'bg-[var(--color-surface)] text-white border border-b-0 border-[var(--color-border)]' : 'bg-[var(--color-bg)] text-[var(--color-text-dim)] hover:text-white'}`}
          >Dashboard</button>
          <button onClick={() => setTab('trades')}
            className={`px-4 py-1.5 rounded-t text-xs mono font-medium transition-colors ${tab === 'trades' ? 'bg-[var(--color-surface)] text-white border border-b-0 border-[var(--color-border)]' : 'bg-[var(--color-bg)] text-[var(--color-text-dim)] hover:text-white'}`}
          >Trade Log</button>
        </div>
      </div>

      <div className="max-w-[1440px] mx-auto px-2 pb-2 space-y-2">
        {tab === 'dashboard' && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-2">
              <div className="lg:col-span-3 flex flex-col gap-2">
                <PolymarketPanel round={round} live={live} />
                <SignalPanel data={live} />
              </div>
              <div className="lg:col-span-6">
                <BtcChart />
              </div>
              <div className="lg:col-span-3">
                <StrategyLeaderboard strategies={strategies} onSelect={(name) => fetchStratTrades(name)} />
              </div>
            </div>
            <TradeHistory trades={allStratTrades} onFilterChange={(name) => fetchStratTrades(name)} />
          </>
        )}

        {tab === 'trades' && <TradeLog />}
      </div>
    </div>
  );
}

export default App;

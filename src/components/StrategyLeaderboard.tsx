import type { StrategyRow } from '../hooks/useApiData';

export function StrategyLeaderboard({ strategies, onSelect }: { strategies: StrategyRow[]; onSelect: (name: string) => void }) {
  if (strategies.length === 0) return null;

  return (
    <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold">Strategy Leaderboard</div>
        <div className="text-[10px] text-[var(--color-text-dim)] mono">{strategies.length} strategies</div>
      </div>

      {/* Header */}
      <div className="grid grid-cols-7 gap-1 text-[9px] text-[var(--color-text-dim)] mb-1.5 mono px-1">
        <div className="col-span-2">Strategy</div>
        <div className="text-right">Balance</div>
        <div className="text-right">P&L</div>
        <div className="text-right">Win Rate</div>
        <div className="text-right">Trades</div>
        <div className="text-right">DD</div>
      </div>

      {strategies.map((s, i) => {
        const pnlColor = s.totalPnl >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]';
        const ddColor = s.maxDrawdown > 0.30 ? 'text-[var(--color-down)]' : s.maxDrawdown > 0.15 ? 'text-[var(--color-skip)]' : '';
        const isLeader = i === 0 && s.totalPnl > 0;

        return (
          <div
            key={s.name}
            onClick={() => onSelect(s.name)}
            className={`grid grid-cols-7 gap-1 text-[10px] mono py-1.5 px-1 rounded cursor-pointer hover:bg-[var(--color-surface-2)] transition-colors ${isLeader ? 'bg-[var(--color-up)]/8 border-l-2 border-[var(--color-up)]' : ''}`}
          >
            <div className="col-span-2 flex items-center gap-1.5">
              <span className="text-[var(--color-text-dim)] text-[9px] w-4">#{i + 1}</span>
              <span className={`font-medium ${s.name === 'BASELINE' ? 'text-[var(--color-accent)]' : 'text-white'}`}>{s.name}</span>
              {s.insufficient && <span className="text-[7px] text-[var(--color-skip)]">*</span>}
            </div>
            <div className="text-right">${s.balance.toFixed(0)}</div>
            <div className={`text-right font-medium ${pnlColor}`}>{s.totalPnl >= 0 ? '+' : ''}{s.totalPnl.toFixed(1)}</div>
            <div className="text-right">{s.totalTrades > 0 ? (s.winRate * 100).toFixed(0) + '%' : '-'}</div>
            <div className="text-right">
              <span className="text-[var(--color-up)]">{s.wins}</span>/<span className="text-[var(--color-down)]">{s.losses}</span>
            </div>
            <div className={`text-right ${ddColor}`}>{(s.maxDrawdown * 100).toFixed(0)}%</div>
          </div>
        );
      })}

      <div className="text-[8px] text-[var(--color-text-dim)] mt-2 px-1">
        Click strategy to filter trades | <span className="text-[var(--color-skip)]">*</span> = &lt;20 trades
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';

interface StrategyRow {
  name: string;
  balance: number;
  totalPnl: number;
  wins: number;
  losses: number;
  totalTrades: number;
  winRate: number;
  maxDrawdown: number;
  score: number;
  insufficient: boolean;
}

export function StrategyLeaderboard() {
  const [rows, setRows] = useState<StrategyRow[]>([]);

  useEffect(() => {
    const fetch_ = async () => {
      try {
        const res = await fetch('/api/strategies/leaderboard');
        if (res.ok) setRows(await res.json());
      } catch { /* silent */ }
    };
    fetch_();
    const interval = setInterval(fetch_, 10000);
    return () => clearInterval(interval);
  }, []);

  if (rows.length === 0) {
    return (
      <div className="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-4">
        <div className="text-xs font-semibold">Strategy Leaderboard</div>
        <div className="text-[10px] text-[var(--color-text-dim)] text-center py-3">Loading strategies...</div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold">Strategy Leaderboard</div>
        <div className="text-[10px] text-[var(--color-text-dim)] mono">{rows.length} strategies</div>
      </div>

      {/* Header */}
      <div className="grid grid-cols-8 gap-1 text-[9px] text-[var(--color-text-dim)] mb-1 mono">
        <div className="col-span-2">Strategy</div>
        <div className="text-right">Balance</div>
        <div className="text-right">P&L</div>
        <div className="text-right">WR</div>
        <div className="text-right">Trades</div>
        <div className="text-right">DD</div>
        <div className="text-right">Score</div>
      </div>

      {/* Rows */}
      <div className="space-y-0.5">
        {rows.map((s, i) => {
          const pnlColor = s.totalPnl >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]';
          const ddColor = s.maxDrawdown > 0.30 ? 'text-[#ef5350]' : s.maxDrawdown > 0.15 ? 'text-[#ffd54f]' : 'text-[var(--color-text)]';
          const rankBg = i === 0 ? 'bg-[#26a69a]/10 border-l-2 border-[#26a69a]' : '';

          return (
            <div key={s.name} className={`grid grid-cols-8 gap-1 text-[10px] mono py-1 px-1 rounded ${rankBg}`}>
              <div className="col-span-2 flex items-center gap-1">
                <span className="text-[var(--color-text-dim)] text-[9px]">#{i + 1}</span>
                <span className={`font-medium ${s.name === 'BASELINE' ? 'text-[#5c6bc0]' : 'text-white'}`}>
                  {s.name}
                </span>
                {s.insufficient && <span className="text-[8px] text-[#ffd54f]">*</span>}
              </div>
              <div className="text-right">${s.balance.toFixed(0)}</div>
              <div className={`text-right font-medium ${pnlColor}`}>
                {s.totalPnl >= 0 ? '+' : ''}{s.totalPnl.toFixed(1)}
              </div>
              <div className="text-right">
                {s.totalTrades > 0 ? (s.winRate * 100).toFixed(0) + '%' : '-'}
              </div>
              <div className="text-right">
                <span className="text-[#26a69a]">{s.wins}</span>/<span className="text-[#ef5350]">{s.losses}</span>
              </div>
              <div className={`text-right ${ddColor}`}>
                {(s.maxDrawdown * 100).toFixed(0)}%
              </div>
              <div className="text-right font-medium">
                {s.insufficient ? <span className="text-[#ffd54f] text-[8px]">N/A</span> : s.score.toFixed(0)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-[8px] text-[var(--color-text-dim)] mt-2">
        Score = PnL×2 - DD×2 + WR×0.3 {' | '}
        <span className="text-[#ffd54f]">*</span> = insufficient data (&lt;20 trades)
      </div>
    </div>
  );
}

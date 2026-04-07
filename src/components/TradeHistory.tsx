import { useState } from 'react';
import type { Trade } from '../hooks/useApiData';

const FILTER_OPTIONS = ['ALL', 'BASELINE', 'AGGRESSIVE', 'SELECTIVE', 'CONTRARIAN', 'TREND_FOLLOWER', 'LATE_ENTRY'];

export function TradeHistory({ trades, onFilterChange }: { trades: Trade[]; onFilterChange: (name: string) => void }) {
  const [filter, setFilter] = useState('ALL');

  const handleFilter = (f: string) => {
    setFilter(f);
    onFilterChange(f);
  };

  return (
    <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold">Trade History</div>
        <div className="flex gap-1">
          {FILTER_OPTIONS.map(f => (
            <button
              key={f}
              onClick={() => handleFilter(f)}
              className={`px-2 py-0.5 rounded text-[9px] mono transition-colors ${
                filter === f ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-text-dim)] hover:text-white'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {trades.length === 0 ? (
        <div className="text-[10px] text-[var(--color-text-dim)] text-center py-4">No trades found</div>
      ) : (
        <div className="space-y-0.5 max-h-64 overflow-y-auto">
          {trades.slice(0, 20).map((t, idx) => <TradeRow key={idx} trade={t} />)}
        </div>
      )}
    </div>
  );
}

function TradeRow({ trade }: { trade: Trade }) {
  const t = trade;
  const isBaseline = t.strategy_name === 'BASELINE';

  const dir = isBaseline
    ? (t.hypothetical_decision === 'BUY_UP' ? 'UP' : 'DOWN')
    : (t.decision === 'BUY_UP' ? 'UP' : 'DOWN');
  const won = dir === t.actual_result;
  const pnl = isBaseline ? (t.hypothetical_pnl ?? 0) : (t.pnl ?? 0);
  const betSize = isBaseline ? (t.hypothetical_bet_size ?? 0) : (t.bet_size ?? 0);
  const entryPrice = isBaseline
    ? (dir === 'UP' ? t.polymarket_up_price : t.polymarket_down_price)
    : t.entry_price;
  const exitPrice = isBaseline ? (won ? 1.0 : 0.0) : t.exit_price;
  const exitReason = isBaseline ? null : t.exit_reason;
  const time = (isBaseline ? t.round_start_time : t.created_at)?.slice(5, 16)?.replace('T', ' ') ?? '';
  const stratName = t.strategy_name ?? 'BASELINE';

  return (
    <div className="flex items-center justify-between text-[10px] mono py-1 px-1 rounded hover:bg-[var(--color-surface-2)]">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={`font-bold w-3 ${won ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}>
          {won ? 'W' : 'L'}
        </span>
        <span className="text-[8px] text-[var(--color-accent)] w-12 truncate">{stratName === 'BASELINE' ? 'BASE' : stratName.slice(0, 5)}</span>
        <span className={dir === 'UP' ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}>{dir}</span>
        <span className="text-[var(--color-text-dim)]">{time}</span>
        <span className="text-white">${betSize.toFixed(1)}</span>
        {entryPrice != null && entryPrice > 0.01 && (
          <span className="text-[var(--color-text-dim)]">
            @{(entryPrice * 100).toFixed(0)}c
            {exitPrice != null ? `\u2192${(exitPrice * 100).toFixed(0)}c` : ''}
          </span>
        )}
        {exitReason && exitReason !== 'held_to_expiry' && (
          <span className="text-[var(--color-skip)] text-[8px]">[{exitReason.split('(')[0]?.trim()}]</span>
        )}
      </div>
      <span className={`font-medium shrink-0 ${pnl >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}>
        {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
      </span>
    </div>
  );
}

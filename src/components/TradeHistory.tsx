import { useState } from 'react';
import type { Trade } from '../hooks/useApiData';

const FILTERS = ['ALL', 'BASELINE', 'AGGRESSIVE', 'SELECTIVE', 'CONTRARIAN', 'TREND_FOLLOWER', 'LATE_ENTRY'];
const SHORT: Record<string, string> = { BASELINE: 'BASE', AGGRESSIVE: 'AGGR', SELECTIVE: 'SELC', CONTRARIAN: 'CONT', TREND_FOLLOWER: 'TRND', LATE_ENTRY: 'LATE' };

export function TradeHistory({ trades, onFilterChange }: { trades: Trade[]; onFilterChange: (name: string) => void }) {
  const [filter, setFilter] = useState('ALL');
  const set = (f: string) => { setFilter(f); onFilterChange(f); };

  return (
    <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
        <div className="text-xs font-semibold">Trade History</div>
        <div className="flex gap-0.5 flex-wrap">
          {FILTERS.map(f => (
            <button key={f} onClick={() => set(f)}
              className={`px-1.5 py-0.5 rounded text-[8px] mono ${filter === f ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-text-dim)] hover:text-white'}`}
            >{f}</button>
          ))}
        </div>
      </div>

      {trades.length === 0 ? (
        <div className="text-[10px] text-[var(--color-text-dim)] text-center py-4">No trades</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[10px] mono">
            <thead>
              <tr className="text-[var(--color-text-dim)] text-[9px]">
                <th className="text-left py-1 w-5"></th>
                <th className="text-left w-10">Strat</th>
                <th className="text-left w-8">Dir</th>
                <th className="text-left">Time</th>
                <th className="text-right w-10">Size</th>
                <th className="text-left pl-2">Price</th>
                <th className="text-left">Exit</th>
                <th className="text-right w-14">P&L</th>
              </tr>
            </thead>
            <tbody>
              {trades.slice(0, 20).map((t, i) => <Row key={i} t={t} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ t }: { t: Trade }) {
  const bl = t.strategy_name === 'BASELINE';
  const dir = bl ? (t.hypothetical_decision === 'BUY_UP' ? 'UP' : 'DOWN') : (t.decision === 'BUY_UP' ? 'UP' : 'DOWN');
  const pnl = bl ? (t.hypothetical_pnl ?? 0) : (t.pnl ?? 0);
  const won = pnl > 0;
  const flat = pnl === 0;
  const bet = bl ? (t.hypothetical_bet_size ?? 0) : (t.bet_size ?? 0);
  const entry = bl ? (dir === 'UP' ? t.polymarket_up_price : t.polymarket_down_price) : t.entry_price;
  const exit = bl ? (won ? 1.0 : flat ? entry : 0.0) : t.exit_price;
  const reason = bl ? null : t.exit_reason;
  const time = (bl ? t.round_start_time : t.created_at)?.slice(5, 16)?.replace('T', ' ') ?? '';
  const sn = SHORT[t.strategy_name ?? ''] ?? t.strategy_name?.slice(0, 4) ?? '';

  const wlColor = flat ? 'text-[var(--color-text-dim)]' : won ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]';
  const pnlColor = pnl > 0 ? 'text-[var(--color-up)]' : pnl < 0 ? 'text-[var(--color-down)]' : 'text-[var(--color-text-dim)]';

  return (
    <tr className="hover:bg-[var(--color-surface-2)] border-t border-[var(--color-border)]/30">
      <td className={`py-0.5 font-bold ${wlColor}`}>{flat ? '-' : won ? 'W' : 'L'}</td>
      <td className="text-[var(--color-accent)] text-[8px]">{sn}</td>
      <td className={dir === 'UP' ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}>{dir}</td>
      <td className="text-[var(--color-text-dim)]">{time}</td>
      <td className="text-right text-white">${bet.toFixed(1)}</td>
      <td className="pl-2 text-[var(--color-text-dim)]">
        {entry && entry > 0.01 ? `${(entry * 100).toFixed(0)}c` : ''}
        {exit != null && entry && entry > 0.01 ? `\u2192${(exit * 100).toFixed(0)}c` : ''}
      </td>
      <td className="text-[var(--color-skip)] text-[8px]">
        {reason && reason !== 'held_to_expiry' ? reason.split('(')[0]?.trim() : ''}
      </td>
      <td className={`text-right font-medium ${pnlColor}`}>
        {pnl > 0 ? '+' : ''}{pnl !== 0 ? '$' + pnl.toFixed(2) : '-'}
      </td>
    </tr>
  );
}

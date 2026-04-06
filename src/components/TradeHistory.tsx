import { useState, useEffect } from 'react';

interface HypTrade {
  id: number;
  round_start_time: string;
  actual_result: string;
  hypothetical_decision: string;
  hypothetical_ev: number;
  hypothetical_pnl: number;
  hypothetical_bet_size: number;
  confidence: number;
  final_score: number;
  polymarket_up_price: number | null;
  polymarket_down_price: number | null;
}

export function TradeHistory() {
  const [trades, setTrades] = useState<HypTrade[]>([]);

  useEffect(() => {
    const fetch_ = async () => {
      try {
        const res = await fetch('/api/training-rounds/trades');
        if (res.ok) setTrades(await res.json());
      } catch { /* silent */ }
    };
    fetch_();
    const interval = setInterval(fetch_, 5000);
    return () => clearInterval(interval);
  }, []);

  if (trades.length === 0) {
    return (
      <div className="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-4">
        <div className="text-xs font-semibold mb-2">Bot Trades (Hypothetical)</div>
        <div className="text-[10px] text-[var(--color-text-dim)] text-center py-3">
          No trades yet. Waiting for BUY signals...
        </div>
      </div>
    );
  }

  const wins = trades.filter(t => {
    const dir = t.hypothetical_decision === 'BUY_UP' ? 'UP' : 'DOWN';
    return dir === t.actual_result;
  }).length;
  const losses = trades.length - wins;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
  const totalPnl = trades.reduce((sum, t) => sum + (t.hypothetical_pnl || 0), 0);

  return (
    <div className="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold">Bot Trades (Hypothetical)</div>
        <div className="flex items-center gap-3 text-[10px] mono">
          <span className="text-[var(--color-text-dim)]">{trades.length} trades</span>
          <span className="text-[#26a69a]">{wins}W</span>
          <span className="text-[#ef5350]">{losses}L</span>
          <span className="text-[var(--color-text-dim)]">{winRate.toFixed(0)}%</span>
          <span className={totalPnl >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'}>
            {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
          </span>
        </div>
      </div>

      <div className="space-y-0.5 max-h-48 overflow-y-auto">
        {trades.map(t => {
          const dir = t.hypothetical_decision === 'BUY_UP' ? 'UP' : 'DOWN';
          const won = dir === t.actual_result;
          const time = t.round_start_time.slice(11, 16);
          const date = t.round_start_time.slice(5, 10);
          const pmPrice = dir === 'UP'
            ? t.polymarket_up_price
            : t.polymarket_down_price;

          return (
            <div key={t.id} className="flex items-center justify-between text-[10px] mono py-0.5">
              <div className="flex items-center gap-1.5">
                <span className={won ? 'text-[#26a69a] font-bold' : 'text-[#ef5350] font-bold'}>
                  {won ? 'W' : 'L'}
                </span>
                <span className={dir === 'UP' ? 'text-[#26a69a]' : 'text-[#ef5350]'}>
                  {dir}
                </span>
                <span className="text-[var(--color-text-dim)]">{date} {time}</span>
                {pmPrice != null && (
                  <span className="text-[var(--color-text-dim)]">@{(pmPrice * 100).toFixed(0)}c</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[var(--color-text-dim)]">
                  EV:{t.hypothetical_ev?.toFixed(3) ?? '0'}
                </span>
                <span className="text-[var(--color-text-dim)]">
                  C:{t.confidence?.toFixed(0)}
                </span>
                <span className={`font-medium ${(t.hypothetical_pnl || 0) >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
                  {(t.hypothetical_pnl || 0) >= 0 ? '+' : ''}${(t.hypothetical_pnl || 0).toFixed(2)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

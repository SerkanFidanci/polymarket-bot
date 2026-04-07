import { useState, useEffect, useCallback } from 'react';

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

interface StrategyTrade {
  id: number;
  strategy_name: string;
  decision: string;
  entry_price: number;
  bet_size: number;
  exit_price: number | null;
  exit_reason: string | null;
  pnl: number;
  actual_result: string;
  created_at: string;
}

export function StrategyLeaderboard() {
  const [rows, setRows] = useState<StrategyRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [trades, setTrades] = useState<StrategyTrade[]>([]);

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

  const fetchTrades = useCallback(async (name: string) => {
    try {
      // BASELINE trades come from training-rounds, others from strategy_trades
      const url = name === 'BASELINE'
        ? '/api/training-rounds/trades'
        : `/api/strategies/${name}/trades`;
      const res = await fetch(url);
      if (res.ok) setTrades(await res.json());
    } catch { setTrades([]); }
  }, []);

  const toggleExpand = (name: string) => {
    if (expanded === name) {
      setExpanded(null);
      setTrades([]);
    } else {
      setExpanded(name);
      fetchTrades(name);
    }
  };

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
      <div className="grid grid-cols-8 gap-1 text-[9px] text-[var(--color-text-dim)] mb-1 mono px-1">
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
          const isExpanded = expanded === s.name;

          return (
            <div key={s.name}>
              <div
                className={`grid grid-cols-8 gap-1 text-[10px] mono py-1 px-1 rounded cursor-pointer hover:bg-[var(--color-surface-2)] transition-colors ${rankBg}`}
                onClick={() => toggleExpand(s.name)}
              >
                <div className="col-span-2 flex items-center gap-1">
                  <span className="text-[var(--color-text-dim)] text-[9px]">#{i + 1}</span>
                  <span className={`font-medium ${s.name === 'BASELINE' ? 'text-[#5c6bc0]' : 'text-white'}`}>
                    {s.name}
                  </span>
                  {s.insufficient && <span className="text-[8px] text-[#ffd54f]">*</span>}
                  <span className="text-[8px] text-[var(--color-text-dim)]">{isExpanded ? '\u25B2' : '\u25BC'}</span>
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

              {/* Expanded trade detail */}
              {isExpanded && (
                <StrategyDetail name={s.name} trades={trades} isBaseline={s.name === 'BASELINE'} />
              )}
            </div>
          );
        })}
      </div>

      <div className="text-[8px] text-[var(--color-text-dim)] mt-2">
        Score = PnL*2 - DD*2 + WR*0.3 {' | '}
        <span className="text-[#ffd54f]">*</span> = insufficient data (&lt;20 trades) {' | '}
        Click to expand trades
      </div>
    </div>
  );
}

function StrategyDetail({ name, trades, isBaseline }: { name: string; trades: unknown[]; isBaseline: boolean }) {
  if (trades.length === 0) {
    return (
      <div className="ml-6 py-2 text-[9px] text-[var(--color-text-dim)]">
        No trades yet for {name}
      </div>
    );
  }

  return (
    <div className="ml-4 mr-1 py-1 border-l-2 border-[var(--color-border)] pl-2 max-h-40 overflow-y-auto">
      {trades.slice(0, 15).map((t: any, idx: number) => {
        // Normalize field names (BASELINE uses different schema)
        const dir = isBaseline
          ? (t.hypothetical_decision === 'BUY_UP' ? 'UP' : 'DOWN')
          : (t.decision === 'BUY_UP' ? 'UP' : 'DOWN');
        const actualResult = isBaseline ? t.actual_result : t.actual_result;
        const won = dir === actualResult;
        const entryPrice = isBaseline
          ? (dir === 'UP' ? t.polymarket_up_price : t.polymarket_down_price)
          : t.entry_price;
        const exitPrice = isBaseline ? null : t.exit_price;
        const exitReason = isBaseline ? null : t.exit_reason;
        const pnl = isBaseline ? (t.hypothetical_pnl || 0) : (t.pnl || 0);
        const betSize = isBaseline ? (t.hypothetical_bet_size || 0) : (t.bet_size || 0);
        const time = isBaseline
          ? t.round_start_time?.slice(5, 16)?.replace('T', ' ')
          : t.created_at?.slice(5, 16)?.replace('T', ' ');

        return (
          <div key={idx} className="flex items-center justify-between text-[9px] mono py-0.5">
            <div className="flex items-center gap-1">
              <span className={won ? 'text-[#26a69a] font-bold' : 'text-[#ef5350] font-bold'}>
                {won ? 'W' : 'L'}
              </span>
              <span className={dir === 'UP' ? 'text-[#26a69a]' : 'text-[#ef5350]'}>
                {dir}
              </span>
              <span className="text-[var(--color-text-dim)]">{time}</span>
              <span className="text-white">${betSize.toFixed(1)}</span>
              {entryPrice != null && entryPrice > 0.01 && (
                <span className="text-[var(--color-text-dim)]">
                  @{(entryPrice * 100).toFixed(0)}c
                  {exitPrice != null && exitPrice > 0 ? `\u2192${(exitPrice * 100).toFixed(0)}c` : won ? '\u2192100c' : '\u21920c'}
                </span>
              )}
              {exitReason && exitReason !== 'held_to_expiry' && (
                <span className="text-[#ffd54f] text-[8px]">[{exitReason.split('(')[0]?.trim()}]</span>
              )}
            </div>
            <span className={`font-medium ${pnl >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
              {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
            </span>
          </div>
        );
      })}
      {trades.length > 15 && (
        <div className="text-[8px] text-[var(--color-text-dim)] text-center py-1">
          +{trades.length - 15} more trades
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';

interface TradeStats {
  totalTrades: number;
  wins: number;
  losses: number;
  totalPnl: number;
  balance: number;
  maxDrawdown: number;
  dailyPnl: number;
}

export function BankrollDashboard() {
  const tradingMode = useStore(s => s.tradingMode);
  const [stats, setStats] = useState<TradeStats>({
    totalTrades: 0, wins: 0, losses: 0, totalPnl: 0,
    balance: 50, maxDrawdown: 0, dailyPnl: 0,
  });

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/training-rounds/trades');
        if (!res.ok) return;
        const trades = await res.json() as Array<{
          hypothetical_decision: string;
          hypothetical_pnl: number;
          actual_result: string;
          round_start_time: string;
        }>;

        let balance = 50;
        let peak = 50;
        let maxDD = 0;
        let wins = 0;
        let dailyPnl = 0;
        const today = new Date().toISOString().slice(0, 10);

        // Trades come DESC — reverse for chronological
        const sorted = [...trades].reverse();
        for (const t of sorted) {
          const dir = t.hypothetical_decision === 'BUY_UP' ? 'UP' : 'DOWN';
          const won = dir === t.actual_result;
          if (won) wins++;
          const pnl = t.hypothetical_pnl || 0;
          balance += pnl;
          if (balance > peak) peak = balance;
          const dd = peak > 0 ? (peak - balance) / peak : 0;
          if (dd > maxDD) maxDD = dd;
          if (t.round_start_time?.slice(0, 10) === today) dailyPnl += pnl;
        }

        setStats({
          totalTrades: trades.length,
          wins,
          losses: trades.length - wins,
          totalPnl: balance - 50,
          balance,
          maxDrawdown: maxDD,
          dailyPnl,
        });
      } catch { /* silent */ }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, []);

  const { balance, totalPnl, dailyPnl, wins, losses, maxDrawdown, totalTrades } = stats;
  const winRate = totalTrades > 0 ? (wins / totalTrades * 100) : 0;
  const roi = ((balance - 50) / 50 * 100);

  return (
    <div className="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-4">
      {/* Balance */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider">Balance (Hypothetical)</div>
          <div className="mono text-2xl font-bold">${balance.toFixed(2)}</div>
        </div>
        <div className={`text-right mono text-sm font-semibold ${roi >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
          {roi >= 0 ? '+' : ''}{roi.toFixed(1)}%
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-xs">
        <Stat label="Daily P&L" value={`${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)}`} color={dailyPnl >= 0 ? '#26a69a' : '#ef5350'} />
        <Stat label="Total P&L" value={`${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`} color={totalPnl >= 0 ? '#26a69a' : '#ef5350'} />
        <Stat label="Win Rate" value={`${winRate.toFixed(1)}%`} />
        <Stat label="W / L" value={`${wins} / ${losses}`} />
        <Stat label="Drawdown" value={`${(maxDrawdown * 100).toFixed(1)}%`} color={maxDrawdown > 0.15 ? '#ef5350' : undefined} />
        <Stat label="Total Bets" value={`${totalTrades}`} />
      </div>

      {/* Mode indicator */}
      <div className={`mt-3 text-[10px] text-center font-medium mono py-1 rounded ${
        tradingMode === 'live' ? 'bg-[#26a69a]/15 text-[#26a69a]' :
        tradingMode === 'paper' ? 'bg-[#ffd54f]/15 text-[#ffd54f]' :
        'bg-[#5c6bc0]/15 text-[#5c6bc0]'
      }`}>
        {tradingMode === 'passive' ? 'PASSIVE — Observing only' :
         tradingMode === 'paper' ? 'PAPER — Virtual bets' :
         'LIVE TRADING'}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[var(--color-text-dim)]">{label}</span>
      <span className="mono font-medium" style={{ color: color ?? 'var(--color-text)' }}>{value}</span>
    </div>
  );
}

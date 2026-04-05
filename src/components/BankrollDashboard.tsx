import { useStore } from '../store/useStore';

export function BankrollDashboard() {
  const { bankroll, tradingMode } = useStore();
  const { balance, initialBalance, dailyPnl, totalPnl, wins, losses, maxDrawdown } = bankroll;
  const totalBets = wins + losses;
  const winRate = totalBets > 0 ? (wins / totalBets * 100) : 0;
  const roi = initialBalance > 0 ? ((balance - initialBalance) / initialBalance * 100) : 0;

  return (
    <div className="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-4">
      {/* Balance */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider">Balance</div>
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
        <Stat label="Total Bets" value={`${totalBets}`} />
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

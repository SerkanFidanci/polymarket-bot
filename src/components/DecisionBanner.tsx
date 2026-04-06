import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';

interface LastTrade {
  id: number;
  hypothetical_decision: string;
  actual_result: string;
  hypothetical_pnl: number;
  round_start_time: string;
}

export function DecisionBanner() {
  const { lastDecision, systemStatus } = useStore();
  const [lastTrade, setLastTrade] = useState<LastTrade | null>(null);

  useEffect(() => {
    const fetchLastTrade = async () => {
      try {
        const res = await fetch('/api/training-rounds/trades');
        if (res.ok) {
          const trades = await res.json() as LastTrade[];
          if (trades.length > 0) setLastTrade(trades[0]!);
        }
      } catch { /* silent */ }
    };
    fetchLastTrade();
    const interval = setInterval(fetchLastTrade, 10000);
    return () => clearInterval(interval);
  }, []);

  if (systemStatus === 'WARMING_UP') {
    return (
      <div className="bg-[#ffd54f]/10 border border-[#ffd54f]/30 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-[#ffd54f] animate-pulse" />
          <div>
            <div className="text-[#ffd54f] text-lg font-bold mono">WARMING UP</div>
            <div className="text-[var(--color-text-dim)] text-xs">Collecting data for indicators...</div>
          </div>
        </div>
      </div>
    );
  }

  if (!lastDecision) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-[var(--color-text-dim)]" />
          <div className="text-[var(--color-text-dim)] text-lg mono">WAITING</div>
        </div>
      </div>
    );
  }

  const { action, direction, betSize, ev, confidence, ourProbability, kellyFraction, reason } = lastDecision;

  if (action === 'SKIP' || action === 'STOP') {
    const lastTradeDir = lastTrade?.hypothetical_decision === 'BUY_UP' ? 'UP' : 'DOWN';
    const lastTradeWon = lastTrade ? lastTradeDir === lastTrade.actual_result : false;

    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${action === 'STOP' ? 'bg-[#ef5350]' : 'bg-[#ffd54f]'}`} />
            <div className={`text-xl font-bold mono ${action === 'STOP' ? 'text-[#ef5350]' : 'text-[#ffd54f]'}`}>{action}</div>
          </div>
          {lastTrade && (
            <div className="text-[10px] mono text-[var(--color-text-dim)]">
              Last: <span className={lastTradeDir === 'UP' ? 'text-[#26a69a]' : 'text-[#ef5350]'}>{lastTrade.hypothetical_decision.replace('BUY_', '')}</span>
              {' '}#{lastTrade.id}
              {' '}<span className={lastTradeWon ? 'text-[#26a69a]' : 'text-[#ef5350]'}>{lastTradeWon ? 'WIN' : 'LOSS'}</span>
              {' '}<span className={(lastTrade.hypothetical_pnl || 0) >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'}>
                {(lastTrade.hypothetical_pnl || 0) >= 0 ? '+' : ''}${(lastTrade.hypothetical_pnl || 0).toFixed(2)}
              </span>
            </div>
          )}
        </div>
        <div className="text-xs text-[var(--color-text-dim)] mt-2 mono">{reason}</div>
      </div>
    );
  }

  const isUp = direction === 'UP';
  const color = isUp ? '#26a69a' : '#ef5350';
  const bgClass = isUp ? 'bg-[#26a69a]/10 border-[#26a69a]/40' : 'bg-[#ef5350]/10 border-[#ef5350]/40';
  const pulseClass = isUp ? 'pulse-up' : 'pulse-down';

  return (
    <div className={`${bgClass} border rounded-lg p-4 ${pulseClass}`}>
      {/* Main action */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 rounded-full" style={{ background: color }} />
          <div className="mono text-2xl font-bold" style={{ color }}>
            BUY {direction}
          </div>
        </div>
        <div className="mono text-2xl font-bold" style={{ color }}>
          ${betSize?.toFixed(2)}
        </div>
      </div>

      {/* EV Details Row */}
      <div className="grid grid-cols-4 gap-3 text-xs">
        <div>
          <div className="text-[var(--color-text-dim)] text-[10px]">EV</div>
          <div className="mono font-semibold" style={{ color }}>{ev?.toFixed(4)}</div>
        </div>
        <div>
          <div className="text-[var(--color-text-dim)] text-[10px]">Our Prob</div>
          <div className="mono font-semibold text-white">{((ourProbability ?? 0) * 100).toFixed(1)}%</div>
        </div>
        <div>
          <div className="text-[var(--color-text-dim)] text-[10px]">Kelly</div>
          <div className="mono font-semibold text-white">{((kellyFraction ?? 0) * 100).toFixed(1)}%</div>
        </div>
        <div>
          <div className="text-[var(--color-text-dim)] text-[10px]">Confidence</div>
          <div className="mono font-semibold text-white">{confidence?.toFixed(0)}</div>
        </div>
      </div>
    </div>
  );
}

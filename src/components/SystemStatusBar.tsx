import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';

const STATUS_DOT: Record<string, string> = {
  INITIALIZING: 'bg-[#ffd54f]',
  WARMING_UP: 'bg-[#ff9800]',
  RUNNING: 'bg-[#26a69a]',
  PAUSED: 'bg-[#ffd54f]',
  STOPPED: 'bg-[#ef5350]',
  ERROR: 'bg-[#ef5350]',
  MARKET_UNAVAILABLE: 'bg-[#636c7e]',
};

export function SystemStatusBar() {
  const { systemStatus, tradingMode, isConnected, isFuturesConnected, btcPrice } = useStore();
  const dotColor = STATUS_DOT[systemStatus] ?? 'bg-[#636c7e]';

  // Polymarket market status
  const [marketTitle, setMarketTitle] = useState('');

  useEffect(() => {
    const fetchRound = async () => {
      try {
        const res = await fetch('/api/polymarket/current-round');
        if (!res.ok) return;
        const data = await res.json();
        if (data.title) setMarketTitle(data.title);
      } catch { /* silent */ }
    };
    fetchRound();
    const interval = setInterval(fetchRound, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center justify-between px-4 py-1.5 bg-[#0d1117] border-b border-[var(--color-border)] text-[11px] mono">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${dotColor}`} />
          <span className="text-[var(--color-text-dim)]">{systemStatus}</span>
        </div>
        <span className={`px-1.5 py-px rounded text-[10px] font-bold uppercase ${
          tradingMode === 'live' ? 'bg-[#26a69a]/20 text-[#26a69a]' :
          tradingMode === 'paper' ? 'bg-[#ffd54f]/20 text-[#ffd54f]' :
          'bg-[#5c6bc0]/20 text-[#5c6bc0]'
        }`}>
          {tradingMode}
        </span>
      </div>

      <div className="flex items-center gap-4">
        {btcPrice > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-text-dim)]">Binance:</span>
            <span className="text-[var(--color-text)] font-medium">
              ${btcPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            {marketTitle && <span className="text-[9px] text-[#42a5f5] truncate max-w-32">{marketTitle.replace('Bitcoin Up or Down - ','')}</span>}
          </div>
        )}
        <div className="flex items-center gap-3">
          <StatusDot label="Spot" ok={isConnected} />
          <StatusDot label="Futures" ok={isFuturesConnected} />
        </div>
        <span className="text-[var(--color-text-dim)]">
          {new Date().toISOString().split('T')[1]?.slice(0, 8)} UTC
        </span>
      </div>
    </div>
  );
}

function StatusDot({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <div className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-[#26a69a]' : 'bg-[#ef5350]'}`} />
      <span className="text-[var(--color-text-dim)]">{label}</span>
    </div>
  );
}

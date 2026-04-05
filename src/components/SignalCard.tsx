import { useRef, useEffect } from 'react';
import type { SignalResult, SignalName } from '../types/index';

const SIGNAL_META: Record<SignalName, { name: string; group: string; groupColor: string }> = {
  orderbook: { name: 'OrderBook', group: 'A', groupColor: '#42a5f5' },
  ema_macd: { name: 'EMA/MACD', group: 'A', groupColor: '#42a5f5' },
  rsi_stoch: { name: 'RSI/Stoch', group: 'A', groupColor: '#42a5f5' },
  vwap_bb: { name: 'VWAP/BB', group: 'A', groupColor: '#42a5f5' },
  cvd: { name: 'CVD', group: 'B', groupColor: '#ab47bc' },
  whale: { name: 'Whale', group: 'B', groupColor: '#ab47bc' },
  funding: { name: 'Funding', group: 'C', groupColor: '#ff9800' },
  open_interest: { name: 'Open Int', group: 'C', groupColor: '#ff9800' },
  liquidation: { name: 'Liquidation', group: 'C', groupColor: '#ff9800' },
  ls_ratio: { name: 'L/S Ratio', group: 'D', groupColor: '#26c6da' },
};

interface Props {
  signal: SignalResult;
  weight: number;
  accuracy?: number;
}

export function SignalCard({ signal, weight, accuracy }: Props) {
  const meta = SIGNAL_META[signal.name as SignalName] ?? { name: signal.name, group: '?', groupColor: '#666' };
  const score = signal.score;
  const isPositive = score > 0;
  const isNeutral = Math.abs(score) < 5;
  const color = isNeutral ? 'var(--color-text-dim)' : isPositive ? '#26a69a' : '#ef5350';
  const arrow = isNeutral ? '—' : isPositive ? '▲' : '▼';
  const barPct = Math.min(Math.abs(score), 100) / 2; // max 50% each side

  // Sparkline history
  const historyRef = useRef<number[]>([]);
  useEffect(() => {
    historyRef.current.push(score);
    if (historyRef.current.length > 60) historyRef.current.shift();
  }, [score]);

  const sparkline = historyRef.current;
  const sparkMin = Math.min(...sparkline, -10);
  const sparkMax = Math.max(...sparkline, 10);
  const sparkRange = sparkMax - sparkMin || 1;

  const sparkPoints = sparkline.map((v, i) => {
    const x = (i / Math.max(sparkline.length - 1, 1)) * 60;
    const y = 16 - ((v - sparkMin) / sparkRange) * 16;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="bg-[var(--color-surface)] rounded border border-[var(--color-border)] p-2.5 hover:border-[var(--color-accent)] transition-colors">
      {/* Header: group badge + name + weight */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span
            className="text-[9px] font-bold mono w-3.5 h-3.5 rounded flex items-center justify-center"
            style={{ background: `${meta.groupColor}20`, color: meta.groupColor }}
          >
            {meta.group}
          </span>
          <span className="text-[11px] font-medium">{meta.name}</span>
        </div>
        <div className="flex items-center gap-1">
          {accuracy !== undefined && (
            <span className={`text-[9px] mono px-1 rounded ${accuracy >= 0.55 ? 'bg-[#26a69a]/20 text-[#26a69a]' : accuracy >= 0.50 ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]' : 'bg-[#ef5350]/20 text-[#ef5350]'}`}>
              {(accuracy * 100).toFixed(0)}%
            </span>
          )}
          <span className="text-[9px] text-[var(--color-text-dim)] mono">{(weight * 100).toFixed(0)}%</span>
        </div>
      </div>

      {/* Score + arrow */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className="mono text-lg font-bold leading-none" style={{ color }}>
          {score > 0 ? '+' : ''}{score.toFixed(1)}
        </span>
        <span className="text-sm" style={{ color }}>{arrow}</span>
      </div>

      {/* Score bar (centered at 0) */}
      <div className="h-1.5 bg-[var(--color-surface-2)] rounded-full relative mb-2">
        <div className="absolute top-0 left-1/2 w-px h-full bg-[var(--color-border)]" />
        <div
          className="absolute top-0 h-full rounded-full transition-all duration-300"
          style={{
            width: `${barPct}%`,
            left: isPositive ? '50%' : `${50 - barPct}%`,
            background: color,
            opacity: 0.7,
          }}
        />
      </div>

      {/* Mini sparkline */}
      {sparkline.length > 2 && (
        <svg viewBox="0 0 60 16" className="w-full" style={{ height: 16 }}>
          <line x1="0" y1="8" x2="60" y2="8" stroke="#2a2e3e" strokeWidth="0.5" />
          <polyline
            points={sparkPoints}
            fill="none"
            stroke={color}
            strokeWidth="1"
            strokeLinejoin="round"
            opacity="0.6"
          />
        </svg>
      )}
    </div>
  );
}

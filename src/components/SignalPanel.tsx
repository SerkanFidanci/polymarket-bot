import type { LiveData } from '../hooks/useApiData';

const SIGNAL_LABELS: Record<string, string> = {
  orderbook: 'Order Book', ema_macd: 'EMA/MACD', rsi_stoch: 'RSI/Stoch',
  vwap_bb: 'VWAP/BB', cvd: 'CVD', whale: 'Whale', funding: 'Funding',
  open_interest: 'Open Int.', ls_ratio: 'L/S Ratio',
};

const ACTIVE_SIGNALS = ['orderbook', 'ema_macd', 'rsi_stoch', 'vwap_bb', 'cvd', 'whale', 'funding', 'open_interest', 'ls_ratio'];

export function SignalPanel({ data }: { data: LiveData | null }) {
  const signal = data?.signal;
  const weights = data?.weights ?? {};
  const score = signal?.finalScore ?? 0;
  const conf = signal?.confidence ?? 0;
  const dir = score > 0 ? 'UP' : score < 0 ? 'DOWN' : 'NEUTRAL';
  const dirColor = dir === 'UP' ? 'var(--color-up)' : dir === 'DOWN' ? 'var(--color-down)' : 'var(--color-text-dim)';

  return (
    <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4 flex flex-col gap-3">
      {/* Combined Score */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] text-[var(--color-text-dim)] uppercase">Combined Signal</div>
          <div className="mono text-2xl font-bold" style={{ color: dirColor }}>{score.toFixed(1)}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-[var(--color-text-dim)]">Confidence</div>
          <div className="mono text-xl font-bold">{conf.toFixed(0)}</div>
        </div>
      </div>

      {/* Signal List */}
      <div className="space-y-1.5">
        {ACTIVE_SIGNALS.map(name => {
          const s = signal?.signals?.[name];
          const sc = s?.score ?? 0;
          const w = (weights[name] ?? 0) * 100;
          const barWidth = Math.min(Math.abs(sc), 100);
          const isPositive = sc >= 0;

          return (
            <div key={name} className="flex items-center gap-2 text-[10px]">
              <span className="w-16 shrink-0 text-[var(--color-text-dim)] mono">{SIGNAL_LABELS[name] ?? name}</span>
              <div className="flex-1 h-3 bg-[var(--color-surface-2)] rounded-sm relative overflow-hidden">
                <div className="absolute top-0 bottom-0 left-1/2 w-px bg-[var(--color-border)]" />
                <div
                  className="absolute top-0 bottom-0 rounded-sm transition-all duration-300"
                  style={{
                    background: isPositive ? 'var(--color-up)' : 'var(--color-down)',
                    width: `${barWidth / 2}%`,
                    left: isPositive ? '50%' : `${50 - barWidth / 2}%`,
                    opacity: 0.7,
                  }}
                />
              </div>
              <span className={`w-10 text-right mono font-medium ${sc > 0 ? 'text-[var(--color-up)]' : sc < 0 ? 'text-[var(--color-down)]' : 'text-[var(--color-text-dim)]'}`}>
                {sc.toFixed(0)}
              </span>
              <span className="w-8 text-right mono text-[var(--color-text-dim)] text-[9px]">{w.toFixed(0)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

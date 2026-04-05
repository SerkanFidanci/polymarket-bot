import { useStore } from '../store/useStore';

export function SignalGauge() {
  const { currentSignal } = useStore();
  const score = currentSignal?.finalScore ?? 0;
  const confidence = currentSignal?.confidence ?? 0;
  const allAgree = currentSignal?.allGroupsAgree ?? false;

  const isUp = score > 5;
  const isDown = score < -5;
  const color = isUp ? '#26a69a' : isDown ? '#ef5350' : 'var(--color-text-dim)';
  const needlePos = ((score + 100) / 200) * 100;

  return (
    <div className="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-4">
      <div className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-2">Combined Score</div>

      <div className="mono text-3xl font-bold text-center" style={{ color }}>
        {score > 0 ? '+' : ''}{score.toFixed(1)}
      </div>

      {/* Gauge */}
      <div className="mt-3 relative">
        <div className="h-2 rounded-full" style={{
          background: 'linear-gradient(to right, #ef5350, #2a2e3e 40%, #2a2e3e 60%, #26a69a)'
        }} />
        <div
          className="absolute top-[-2px] w-1 h-3 bg-white rounded-full transition-all duration-300"
          style={{ left: `${needlePos}%`, transform: 'translateX(-50%)' }}
        />
      </div>

      <div className="flex justify-between mt-2 text-[10px]">
        <span className="text-[var(--color-text-dim)] mono">Conf: <span className="text-[var(--color-text)]">{confidence.toFixed(0)}</span></span>
        {allAgree && <span className="text-[#26a69a] font-semibold">ALIGNED</span>}
      </div>
    </div>
  );
}

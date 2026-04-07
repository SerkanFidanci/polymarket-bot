import type { LiveData } from '../hooks/useApiData';

const MODE_COLORS: Record<string, string> = {
  passive: 'bg-blue-600', paper: 'bg-yellow-500 text-black', live: 'bg-green-500 text-black',
};

export function StatusBar({ data }: { data: LiveData | null }) {
  const now = new Date();
  const utc = now.toUTCString().slice(17, 25);
  const local = now.toLocaleTimeString();

  return (
    <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] px-4 py-2 flex items-center justify-between text-xs">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${data?.isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="mono font-medium">{data?.isConnected ? 'RUNNING' : 'DISCONNECTED'}</span>
        </div>
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold mono uppercase ${MODE_COLORS[data?.tradingMode ?? 'passive'] ?? 'bg-gray-600'}`}>
          {data?.tradingMode ?? 'loading'}
        </span>
        <span className="text-[var(--color-text-dim)] mono">Rounds: {data?.training.roundCount ?? 0}</span>
      </div>

      <div className="flex items-center gap-4">
        <span className="mono font-semibold text-sm">
          BTC <span className="text-white">${data?.btcPrice?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? '---'}</span>
        </span>
        <span className="text-[var(--color-text-dim)] mono text-[10px]">{utc} UTC | {local}</span>
      </div>
    </div>
  );
}

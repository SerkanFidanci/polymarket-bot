import { useStore } from '../store/useStore';

const LEVEL_STYLE: Record<string, string> = {
  INFO: 'text-[#5c6bc0]',
  WARN: 'text-[#ffd54f]',
  ERROR: 'text-[#ef5350]',
  DEBUG: 'text-[#636c7e]',
  TRADE: 'text-[#26a69a]',
};

export function LogFeed() {
  const { logs } = useStore();
  const recent = logs.slice(-20).reverse();

  return (
    <div className="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-3 max-h-48 overflow-y-auto">
      <div className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-2">Event Log</div>
      <div className="space-y-px">
        {recent.length === 0 ? (
          <div className="text-[11px] text-[var(--color-text-dim)] mono">Waiting...</div>
        ) : (
          recent.map((log, i) => (
            <div key={i} className="text-[11px] mono flex gap-1.5 leading-relaxed">
              <span className="text-[var(--color-text-dim)] shrink-0 w-16">
                {log.timestamp.split('T')[1]?.slice(0, 8)}
              </span>
              <span className={`shrink-0 w-5 text-center ${LEVEL_STYLE[log.level] ?? ''}`}>
                {log.level === 'TRADE' ? '$' : log.level === 'ERROR' ? '!' : log.level === 'WARN' ? '~' : '·'}
              </span>
              <span className="text-[var(--color-text)] truncate">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

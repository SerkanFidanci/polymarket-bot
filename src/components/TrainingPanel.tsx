import { useStore } from '../store/useStore';
import { MIN_ROUNDS_FOR_PAPER, MIN_PAPER_TRADES_FOR_LIVE } from '../utils/constants';
import type { SignalName } from '../types/signals';

const SIGNAL_LABELS: Record<SignalName, string> = {
  orderbook: 'Order Book',
  ema_macd: 'EMA/MACD',
  rsi_stoch: 'RSI/Stoch',
  vwap_bb: 'VWAP/BB',
  cvd: 'CVD',
  whale: 'Whale',
  funding: 'Funding',
  open_interest: 'Open Int.',
  liquidation: 'Liquidation',
  ls_ratio: 'L/S Ratio',
};

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'text-green-400',
  WARNING: 'text-yellow-400',
  DISABLED: 'text-red-400',
};

export function TrainingPanel() {
  const {
    tradingMode, trainingRoundsCount, paperTradesCount,
    signalAccuracies, signalWeights, phaseStatus, optimizationHistory
  } = useStore();

  return (
    <div className="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-4 col-span-1 md:col-span-3">
      <div className="text-xs text-[var(--color-text-dim)] mb-3 flex items-center justify-between">
        <span>Training & Optimization</span>
        <span className="mono text-[10px]">Continuous Self-Learning Engine</span>
      </div>

      {/* Mode + Progress Bar */}
      <div className="flex gap-1 mb-3">
        {(['passive', 'paper', 'live'] as const).map((mode) => (
          <div
            key={mode}
            className={`flex-1 text-center py-1.5 rounded text-xs font-bold mono uppercase ${
              tradingMode === mode
                ? mode === 'passive' ? 'bg-blue-900/50 text-blue-400 border border-blue-700/50'
                : mode === 'paper' ? 'bg-yellow-900/50 text-yellow-400 border border-yellow-700/50'
                : 'bg-green-900/50 text-green-400 border border-green-700/50'
                : 'bg-[var(--color-surface-2)] text-[var(--color-text-dim)]'
            }`}
          >
            {mode}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Column 1: Progress + Phase Checklist */}
        <div>
          {/* Data Progress */}
          {tradingMode === 'passive' && (
            <div className="mb-3">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-[var(--color-text-dim)]">Training Rounds</span>
                <span className="mono">{trainingRoundsCount} / {MIN_ROUNDS_FOR_PAPER}</span>
              </div>
              <div className="h-2.5 bg-[var(--color-surface-2)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, (trainingRoundsCount / MIN_ROUNDS_FOR_PAPER) * 100)}%` }}
                />
              </div>
              <div className="text-[10px] text-[var(--color-text-dim)] mt-1">
                {trainingRoundsCount >= MIN_ROUNDS_FOR_PAPER
                  ? 'Ready for paper trading!'
                  : `Need ${MIN_ROUNDS_FOR_PAPER - trainingRoundsCount} more rounds`}
              </div>
            </div>
          )}

          {tradingMode === 'paper' && (
            <div className="mb-3">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-[var(--color-text-dim)]">Paper Trades</span>
                <span className="mono">{paperTradesCount} / {MIN_PAPER_TRADES_FOR_LIVE}</span>
              </div>
              <div className="h-2.5 bg-[var(--color-surface-2)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-yellow-500 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, (paperTradesCount / MIN_PAPER_TRADES_FOR_LIVE) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Phase Checklist */}
          {phaseStatus && (
            <div className="space-y-1">
              <div className="text-[11px] text-[var(--color-text-dim)] mb-1">
                Phase: {phaseStatus.currentMode.toUpperCase()} → {phaseStatus.nextMode?.toUpperCase() ?? '—'}
              </div>
              {phaseStatus.checks.map((check, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[11px]">
                  <span className={check.met ? 'text-green-400' : 'text-red-400'}>{check.met ? '✓' : '✗'}</span>
                  <span className={check.met ? 'text-[var(--color-text)]' : 'text-[var(--color-text-dim)]'}>{check.label}</span>
                </div>
              ))}
              {phaseStatus.canAdvance && (
                <div className="mt-2 text-[10px] text-center text-green-400 bg-green-900/20 rounded py-1 font-bold">
                  READY TO ADVANCE
                </div>
              )}
            </div>
          )}

          {!phaseStatus && tradingMode === 'passive' && (
            <div className="text-[11px] text-[var(--color-text-dim)]">
              Collecting data. Phase check runs every 100 rounds.
            </div>
          )}
        </div>

        {/* Column 2: Signal Accuracy Table */}
        <div>
          <div className="text-[11px] text-[var(--color-text-dim)] mb-2">Signal Accuracy (10)</div>
          {signalAccuracies.length === 0 ? (
            <div className="text-[10px] text-[var(--color-text-dim)] py-2">
              Waiting for first accuracy check (100 rounds)...
            </div>
          ) : (
            <div className="space-y-1">
              {signalAccuracies.map((acc) => (
                <div key={acc.signalName} className="flex items-center justify-between text-[10px]">
                  <div className="flex items-center gap-1.5">
                    <span className={STATUS_COLORS[acc.status] ?? 'text-gray-400'}>
                      {acc.status === 'ACTIVE' ? '●' : acc.status === 'WARNING' ? '▲' : '✗'}
                    </span>
                    <span className="mono w-20 shrink-0">{SIGNAL_LABELS[acc.signalName] ?? acc.signalName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`mono ${acc.accuracy >= 0.55 ? 'text-green-400' : acc.accuracy >= 0.50 ? 'text-white' : 'text-red-400'}`}>
                      {(acc.accuracy * 100).toFixed(1)}%
                    </span>
                    <span className="text-[var(--color-text-dim)] mono w-8 text-right">
                      {acc.totalPredictions}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Column 3: Weights + Optimization History */}
        <div>
          <div className="text-[11px] text-[var(--color-text-dim)] mb-2">Current Weights</div>
          <div className="space-y-0.5 mb-3">
            {(Object.entries(signalWeights) as [SignalName, number][]).map(([name, weight]) => (
              <div key={name} className="flex items-center justify-between text-[10px]">
                <span className="mono w-20 shrink-0 text-[var(--color-text-dim)]">
                  {SIGNAL_LABELS[name] ?? name}
                </span>
                <div className="flex items-center gap-1">
                  <div className="w-16 h-1.5 bg-[var(--color-surface-2)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[var(--color-accent)] rounded-full"
                      style={{ width: `${weight * 100 * 2}%` }}
                    />
                  </div>
                  <span className="mono w-8 text-right text-white">{(weight * 100).toFixed(0)}%</span>
                </div>
              </div>
            ))}
          </div>

          {/* Optimization Log */}
          <div className="text-[11px] text-[var(--color-text-dim)] mb-1">Optimization Log</div>
          {optimizationHistory.length === 0 ? (
            <div className="text-[10px] text-[var(--color-text-dim)]">No optimizations yet</div>
          ) : (
            <div className="space-y-1 max-h-20 overflow-y-auto">
              {optimizationHistory.slice(-5).reverse().map((entry, i) => (
                <div key={i} className="text-[10px] flex items-center gap-1">
                  <span className={entry.applied ? 'text-green-400' : 'text-[var(--color-text-dim)]'}>
                    {entry.applied ? '✓' : '—'}
                  </span>
                  <span className="text-[var(--color-text-dim)] truncate">{entry.reason}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

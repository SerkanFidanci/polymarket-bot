import { useState, useEffect } from 'react';
import type { PMRound, LiveData } from '../hooks/useApiData';

export function PolymarketPanel({ round, live }: { round: PMRound | null; live: LiveData | null }) {
  const [timeLeft, setTimeLeft] = useState(0);
  const [liveUp, setLiveUp] = useState(0);
  const [liveDown, setLiveDown] = useState(0);

  // Timer
  useEffect(() => {
    const tick = () => {
      if (round?.endTime) setTimeLeft(Math.max(0, Math.floor((round.endTime - Date.now()) / 1000)));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [round?.endTime]);

  // Direct CLOB price polling — every 3 seconds for real-time prices
  useEffect(() => {
    if (!round) return;
    const upId = round.tokenIdUp;
    const dnId = round.tokenIdDown;
    if (!upId || !dnId) return;

    const fetchPrices = async () => {
      try {
        const res = await fetch(`/api/polymarket/prices?up=${encodeURIComponent(upId)}&down=${encodeURIComponent(dnId)}`);
        if (res.ok) {
          const data = await res.json() as { priceUp: number; priceDown: number };
          if (data.priceUp > 0 && data.priceUp < 1) setLiveUp(data.priceUp);
          if (data.priceDown > 0 && data.priceDown < 1) setLiveDown(data.priceDown);
        }
      } catch { /* silent */ }
    };

    fetchPrices();
    const id = setInterval(fetchPrices, 2000);
    return () => clearInterval(id);
  }, [round?.slug]);

  // Use live CLOB prices, fallback to training loop prices, then Gamma
  const upPrice = liveUp || live?.training.roundUpPrice || round?.priceUp || 0;
  const downPrice = liveDown || live?.training.roundDownPrice || round?.priceDown || 0;

  const min = Math.floor(timeLeft / 60);
  const sec = timeLeft % 60;
  const pct = round ? ((300 - timeLeft) / 300) * 100 : 0;

  return (
    <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-[var(--color-text-dim)]">Polymarket</div>
        {round && <div className="text-[10px] text-[var(--color-text-dim)] mono">{round.title.replace('Bitcoin Up or Down - ', '')}</div>}
      </div>

      {!round ? (
        <div className="text-center py-4 text-[var(--color-skip)] text-xs animate-pulse">Searching for round...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <PriceBox label="UP" price={upPrice} color="var(--color-up)" />
            <PriceBox label="DOWN" price={downPrice} color="var(--color-down)" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-[var(--color-text-dim)]">
                {timeLeft < 30 ? 'CLOSING' : timeLeft <= 270 ? 'ENTRY WINDOW' : 'WAITING'}
              </span>
              <span className="mono text-lg font-bold">{min}:{String(sec).padStart(2, '0')}</span>
            </div>
            <div className="h-1.5 bg-[var(--color-surface-2)] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{ width: `${pct}%`, background: timeLeft < 30 ? 'var(--color-down)' : 'var(--color-accent)' }}
              />
            </div>
          </div>

          <div className="flex justify-between text-[10px] text-[var(--color-text-dim)] mono">
            <span>Fee: {(0.072 * upPrice * (1 - upPrice) * 100).toFixed(1)}%</span>
            <span>Spread: {(Math.abs((upPrice + downPrice) - 1) * 100).toFixed(1)}c</span>
          </div>
        </>
      )}
    </div>
  );
}

function PriceBox({ label, price, color }: { label: string; price: number; color: string }) {
  return (
    <div className="rounded-lg p-3 text-center border" style={{ borderColor: color + '30', background: color + '08' }}>
      <div className="text-[10px] font-medium mb-1" style={{ color }}>{label}</div>
      <div className="mono text-2xl font-bold" style={{ color }}>{(price * 100).toFixed(1)}<span className="text-sm">c</span></div>
      <div className="text-[10px] text-[var(--color-text-dim)] mt-0.5">{(price * 100).toFixed(0)}% implied</div>
    </div>
  );
}

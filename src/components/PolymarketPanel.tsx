import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../store/useStore';

interface RoundData {
  title: string;
  slug: string;
  conditionId: string;
  tokenIdUp: string;
  tokenIdDown: string;
  priceUp: number;
  priceDown: number;
  bestBid: number;
  bestAsk: number;
  active: boolean;
  closed: boolean;
  acceptingOrders: boolean;
  startTime: number;
  endTime: number;
}

export function PolymarketPanel() {
  const [round, setRound] = useState<RoundData | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [searching, setSearching] = useState(true);
  const [apiConnected, setApiConnected] = useState(false);
  const [lastResult] = useState<('W' | 'L' | '-')[]>(['-', '-', '-', '-', '-']);

  // Fetch current round (only update metadata, not prices — prices come from CLOB)
  const fetchRound = useCallback(async () => {
    try {
      const res = await fetch('/api/polymarket/current-round');
      if (!res.ok) return;
      const data = await res.json();
      if (data.found === false) {
        // Don't clear round immediately — keep showing old round as "ENDED"
        // until new round is found (Gamma API can take 1-4 min to publish)
        setSearching(true);
      } else {
        setSearching(false);
        setRound(prev => {
          // New round (different slug) — set everything
          if (!prev || prev.slug !== data.slug) return data;
          // Same round — only update metadata, keep CLOB prices
          return { ...prev, acceptingOrders: data.acceptingOrders, closed: data.closed, active: data.active };
        });
      }
    } catch {
      // Don't clear round on network error
    }
  }, []);

  // Sync round to global store (single source of truth for PaperTrading)
  const setPolyRound = useStore(s => s.setPolyRound);
  useEffect(() => {
    if (round) {
      setPolyRound({
        slug: round.slug,
        title: round.title,
        priceUp: round.priceUp,
        priceDown: round.priceDown,
        endTime: round.endTime,
        acceptingOrders: round.acceptingOrders,
        tokenIdUp: round.tokenIdUp,
        tokenIdDown: round.tokenIdDown,
      });
    } else {
      setPolyRound(null);
    }
  }, [round?.slug, round?.priceUp, round?.priceDown, round?.acceptingOrders]);

  // Check API status
  useEffect(() => {
    fetch('/api/polymarket/status')
      .then(r => r.json())
      .then((d: { configured: boolean }) => setApiConnected(d.configured))
      .catch(() => {});
  }, []);

  // Poll for round — faster when searching for next round
  useEffect(() => {
    fetchRound();
    const interval = setInterval(fetchRound, searching ? 3000 : 5000);
    return () => clearInterval(interval);
  }, [fetchRound, searching]);

  // Countdown timer
  useEffect(() => {
    const interval = setInterval(() => {
      if (round) {
        const left = Math.max(0, Math.floor((round.endTime - Date.now()) / 1000));
        setTimeLeft(left);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [round]);

  // Refresh prices every 3s via CLOB order book (real-time)
  useEffect(() => {
    if (!round?.tokenIdUp || !round?.tokenIdDown) return;
    const upId = round.tokenIdUp;
    const downId = round.tokenIdDown;
    const roundSlug = round.slug;
    const fetchPrices = async () => {
      try {
        const res = await fetch(`/api/polymarket/prices?up=${encodeURIComponent(upId)}&down=${encodeURIComponent(downId)}&slug=${encodeURIComponent(roundSlug)}`);
        if (res.ok) {
          const data = await res.json() as { priceUp: number; priceDown: number };
          setRound(prev => prev ? { ...prev, priceUp: data.priceUp, priceDown: data.priceDown } : null);
        }
      } catch { /* silent */ }
    };
    fetchPrices();
    const interval = setInterval(fetchPrices, 3000);
    return () => clearInterval(interval);
  }, [round?.tokenIdUp, round?.tokenIdDown]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const elapsed = round ? Math.max(0, 300 - timeLeft) : 0;
  const timerPct = (elapsed / 300) * 100;
  const isEntryWindow = timeLeft >= 30 && timeLeft <= 270;

  return (
    <div className="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold">Polymarket</div>
          {round && (
            <div className="text-[10px] text-[var(--color-text-dim)] mt-0.5">{round.title.replace('Bitcoin Up or Down - ', '')}</div>
          )}
        </div>
        <span className={`text-[10px] mono px-1.5 py-0.5 rounded ${
          apiConnected ? 'bg-[#26a69a]/20 text-[#26a69a]' :
          'bg-[var(--color-surface-2)] text-[var(--color-text-dim)]'
        }`}>
          {apiConnected ? 'API OK' : 'NO KEY'}
        </span>
      </div>

      {/* Searching state — only show when no round at all */}
      {searching && !round && (
        <div className="text-center py-3">
          <div className="text-[#ffd54f] text-xs animate-pulse">Searching for active BTC 5-min market...</div>
        </div>
      )}

      {/* Between rounds — old round ended, waiting for Gamma API to publish next */}
      {searching && round && timeLeft === 0 && (
        <div className="text-center py-1">
          <div className="text-[#ffd54f] text-[10px] animate-pulse">Waiting for next round from Polymarket...</div>
        </div>
      )}

      {/* Up/Down Prices */}
      {round && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <PriceBox label="UP" price={round.priceUp} color="#26a69a" />
            <PriceBox label="DOWN" price={round.priceDown} color="#ef5350" />
          </div>

          {/* Round Timer */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-[var(--color-text-dim)]">
                {round.acceptingOrders ? (isEntryWindow ? 'ENTRY WINDOW' : timeLeft < 30 ? 'CLOSING' : 'WAITING') : 'CLOSED'}
              </span>
              <span className="mono font-bold text-lg">{minutes}:{seconds.toString().padStart(2, '0')}</span>
            </div>
            <div className="h-1.5 bg-[var(--color-surface-2)] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{
                  width: `${timerPct}%`,
                  background: timeLeft < 30 ? '#ef5350' : isEntryWindow ? '#26a69a' : '#5c6bc0',
                }}
              />
            </div>
            <div className="flex justify-between text-[9px] text-[var(--color-text-dim)] mt-0.5 mono">
              <span>0s</span>
              <span className={isEntryWindow ? 'text-[#26a69a] font-bold' : ''}>IDEAL 30-90s</span>
              <span>300s</span>
            </div>
          </div>

          {/* Spread info */}
          <div className="flex justify-between text-[10px] text-[var(--color-text-dim)]">
            <span>Spread: <span className="text-[var(--color-text)] mono">{((round.bestAsk - round.bestBid) * 100).toFixed(1)}¢</span></span>
            <span>Bid: <span className="mono">{round.bestBid}</span> Ask: <span className="mono">{round.bestAsk}</span></span>
          </div>
        </>
      )}

      {/* Last 5 Rounds */}
      <div>
        <div className="text-[10px] text-[var(--color-text-dim)] mb-1">Last 5 Rounds</div>
        <div className="flex gap-1">
          {lastResult.map((r, i) => (
            <div
              key={i}
              className={`flex-1 h-6 rounded text-[10px] mono font-bold flex items-center justify-center ${
                r === 'W' ? 'bg-[#26a69a]/20 text-[#26a69a]' :
                r === 'L' ? 'bg-[#ef5350]/20 text-[#ef5350]' :
                'bg-[var(--color-surface-2)] text-[var(--color-text-dim)]'
              }`}
            >
              {r}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PriceBox({ label, price, color }: { label: string; price: number; color: string }) {
  return (
    <div className="rounded-lg p-3 text-center" style={{ background: `${color}10`, border: `1px solid ${color}30` }}>
      <div className="text-[10px] mb-1" style={{ color }}>{label}</div>
      <div className="mono text-xl font-bold" style={{ color }}>{(price * 100).toFixed(1)}¢</div>
      <div className="text-[10px] text-[var(--color-text-dim)] mt-0.5">
        {(price * 100).toFixed(0)}% implied
      </div>
    </div>
  );
}

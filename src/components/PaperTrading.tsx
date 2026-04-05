import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../store/useStore';

interface OpenPosition {
  id: number;
  direction: string;
  shares: number;
  entryPrice: number;
  betSize: number;
  roundSlug: string;
  roundTitle: string;
  btcEntryPrice: number;
  roundEndTime: number;
}

interface PaperBalance {
  balance: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
}

interface TradeHistory {
  id: number;
  paper_bet_direction: string;
  paper_bet_size: number;
  paper_entry_price: number;
  paper_result: string | null;
  paper_pnl: number | null;
}

const BET_AMOUNTS = [1, 5, 10];

export function PaperTrading() {
  const [balance, setBalance] = useState<PaperBalance>({ balance: 50, totalTrades: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0 });
  const [openPos, setOpenPos] = useState<OpenPosition | null>(null);
  const [history, setHistory] = useState<TradeHistory[]>([]);
  const [betSize, setBetSize] = useState(5);
  const [timeLeft, setTimeLeft] = useState(0);
  const [placing, setPlacing] = useState(false);

  // Single source of truth
  const round = useStore(s => s.polyRound);
  const btcPrice = useStore(s => s.btcPrice);

  // Current position value
  const currentPrice = openPos
    ? (openPos.direction === 'UP' ? (round?.priceUp ?? 0.5) : (round?.priceDown ?? 0.5))
    : 0;
  const currentValue = openPos ? openPos.shares * currentPrice : 0;
  const unrealizedPnl = openPos ? currentValue - openPos.betSize : 0;
  const unrealizedPct = openPos && openPos.betSize > 0 ? (unrealizedPnl / openPos.betSize) * 100 : 0;

  // Fetch balance + open position + history
  // IMPORTANT: preserve roundEndTime and btcEntryPrice from local state (not in DB)
  const refresh = useCallback(async () => {
    try {
      const [balRes, openRes, histRes] = await Promise.all([
        fetch('/api/paper-trades/balance'),
        fetch('/api/paper-trades/open'),
        fetch('/api/paper-trades'),
      ]);
      if (balRes.ok) setBalance(await balRes.json());
      if (openRes.ok) {
        const data = await openRes.json();
        if (data.none) {
          setOpenPos(null);
        } else {
          setOpenPos(prev => ({
            id: data.id,
            direction: data.paper_bet_direction,
            shares: data.paper_bet_size / data.paper_entry_price,
            entryPrice: data.paper_entry_price,
            betSize: data.paper_bet_size,
            roundSlug: data.signal_weights_used,
            roundTitle: data.threshold_config_used,
            // Preserve local-only fields if same position
            btcEntryPrice: prev && prev.id === data.id ? prev.btcEntryPrice : 0,
            roundEndTime: prev && prev.id === data.id ? prev.roundEndTime : 0,
          }));
        }
      }
      if (histRes.ok) setHistory(await histRes.json());
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Timer
  useEffect(() => {
    const interval = setInterval(() => {
      if (round) setTimeLeft(Math.max(0, Math.floor((round.endTime - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, [round]);

  // Auto-resolve: two mechanisms
  // 1) Timer-based: roundEndTime passed
  // 2) Slug-based: round changed (backup)
  useEffect(() => {
    if (!openPos) return;
    const check = () => {
      // Mechanism 1: timer expired
      if (openPos.roundEndTime > 0 && Date.now() > openPos.roundEndTime + 5000) {
        autoResolveAtExpiry();
        return;
      }
      // Mechanism 2: slug changed (round advanced while we had position)
      if (round && openPos.roundSlug && round.slug !== openPos.roundSlug) {
        autoResolveAtExpiry();
        return;
      }
    };
    check();
    const interval = setInterval(check, 3000);
    return () => clearInterval(interval);
  }, [openPos?.id, openPos?.roundEndTime, round?.slug]);

  const canTrade = round && round.acceptingOrders && timeLeft >= 30 && !openPos && !placing;
  const canExit = openPos && round && !placing;

  // BUY — acquire tokens
  async function placeTrade(direction: 'UP' | 'DOWN') {
    if (!canTrade || !round) return;
    setPlacing(true);
    try {
      const entryPrice = direction === 'UP' ? round.priceUp : round.priceDown;
      if (entryPrice <= 0.01 || entryPrice >= 0.99) { setPlacing(false); return; }
      const res = await fetch('/api/paper-trades/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          direction,
          betSize,
          entryPrice,
          roundSlug: round.slug,
          roundTitle: round.title,
          btcPrice: 0,
          bankrollBefore: balance.balance,
        }),
      });
      if (res.ok) {
        const result = await res.json() as { id: number };
        // Set state with all local-only fields included
        setOpenPos({
          id: result.id, direction, shares: betSize / entryPrice, entryPrice, betSize,
          roundSlug: round.slug, roundTitle: round.title, btcEntryPrice: btcPrice,
          roundEndTime: round.endTime,
        });
        // Refresh balance and history only (not openPos — we just set it)
        try {
          const [balRes, histRes] = await Promise.all([
            fetch('/api/paper-trades/balance'),
            fetch('/api/paper-trades'),
          ]);
          if (balRes.ok) setBalance(await balRes.json());
          if (histRes.ok) setHistory(await histRes.json());
        } catch { /* silent */ }
      }
    } catch { /* silent */ }
    setPlacing(false);
  }

  // EXIT — sell tokens at current market price (like Polymarket "Sell" button)
  async function exitPosition() {
    if (!openPos || !round) return;
    setPlacing(true);
    try {
      // Sell at current price → P&L = (currentPrice - entryPrice) * shares
      const exitPrice = openPos.direction === 'UP' ? round.priceUp : round.priceDown;
      const pnl = (exitPrice - openPos.entryPrice) * openPos.shares;
      const won = pnl >= 0;

      await fetch('/api/paper-trades/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actualResult: won ? openPos.direction : (openPos.direction === 'UP' ? 'DOWN' : 'UP'),
          btcPriceEnd: 0,
          manualExit: true,
          exitPrice,
          pnlOverride: pnl,
        }),
      });
      await refresh();
    } catch { /* silent */ }
    setPlacing(false);
  }

  // Auto-resolve at expiry — round ended, get result from Polymarket
  async function autoResolveAtExpiry() {
    if (!openPos) return;

    try {
      // Fetch the closed round's final prices from Polymarket
      const res = await fetch(`/api/polymarket/prices?up=x&down=x&slug=${openPos.roundSlug}`);
      let actualResult: string;

      if (res.ok) {
        const prices = await res.json() as { priceUp: number; priceDown: number };
        // Resolved round: winner ~1.00, loser ~0.00
        if (prices.priceUp > 0.7) {
          actualResult = 'UP';
        } else if (prices.priceDown > 0.7) {
          actualResult = 'DOWN';
        } else {
          // Not yet resolved — wait and retry
          return;
        }
      } else {
        return; // API error — don't resolve yet
      }

      const won = openPos.direction === actualResult;
      const pnl = won
        ? openPos.shares * (1 - openPos.entryPrice)  // token = $1
        : -openPos.betSize;  // token = $0

      await fetch('/api/paper-trades/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actualResult, btcPriceEnd: btcPrice, pnlOverride: pnl }),
      });
      await refresh();
    } catch { /* silent */ }
  }

  const roi = ((balance.balance - 50) / 50 * 100);

  return (
    <div className="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-4 flex flex-col gap-3">
      {/* Header + Balance */}
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold">Paper Trading</div>
        <div className="text-right">
          <div className="mono text-lg font-bold">${balance.balance.toFixed(2)}</div>
          <div className={`text-[10px] mono ${roi >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
            {roi >= 0 ? '+' : ''}{roi.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Open Position — Polymarket style */}
      {openPos && (
        <div className={`rounded-lg p-3 ${openPos.direction === 'UP' ? 'bg-[#26a69a]/10 border border-[#26a69a]/30' : 'bg-[#ef5350]/10 border border-[#ef5350]/30'}`}>
          {/* Position header */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold mono" style={{ color: openPos.direction === 'UP' ? '#26a69a' : '#ef5350' }}>
                {openPos.direction}
              </span>
              <span className="text-[10px] text-[var(--color-text-dim)]">
                {openPos.shares.toFixed(1)} shares @ {(openPos.entryPrice * 100).toFixed(1)}¢
              </span>
            </div>
          </div>

          {/* Value + P&L */}
          <div className="grid grid-cols-3 gap-2 text-[11px] mb-2">
            <div>
              <div className="text-[9px] text-[var(--color-text-dim)]">Cost</div>
              <div className="mono">${openPos.betSize.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-[9px] text-[var(--color-text-dim)]">Value</div>
              <div className="mono">${currentValue.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-[9px] text-[var(--color-text-dim)]">P&L</div>
              <div className={`mono font-bold ${unrealizedPnl >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
                {unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnl.toFixed(2)}
                <span className="text-[9px] font-normal"> ({unrealizedPct >= 0 ? '+' : ''}{unrealizedPct.toFixed(0)}%)</span>
              </div>
            </div>
          </div>

          {/* Current price + Exit button */}
          <div className="flex items-center gap-2">
            <div className="flex-1 text-[10px] text-[var(--color-text-dim)]">
              Now: <span className="text-[var(--color-text)] mono">{(currentPrice * 100).toFixed(1)}¢</span>
            </div>
            <button
              onClick={exitPosition}
              disabled={!canExit}
              className="px-4 py-1.5 rounded text-xs font-bold mono transition-all disabled:opacity-30 bg-[var(--color-surface-2)] hover:bg-[#5c6bc0] text-white border border-[var(--color-border)] hover:border-[#5c6bc0] active:scale-95"
            >
              SELL @ {(currentPrice * 100).toFixed(1)}¢
            </button>
          </div>

          <div className="text-[9px] text-[var(--color-text-dim)] mt-1.5 truncate">
            {openPos.roundTitle} • Hold for ${(openPos.shares * 1).toFixed(2)} if correct
          </div>
        </div>
      )}

      {/* Trade Buttons — shown when no position */}
      {!openPos && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--color-text-dim)]">Bet:</span>
            <div className="flex gap-1">
              {BET_AMOUNTS.map(amt => (
                <button
                  key={amt}
                  onClick={() => setBetSize(amt)}
                  className={`px-2 py-0.5 rounded text-[11px] mono font-medium transition-colors ${
                    betSize === amt
                      ? 'bg-[#5c6bc0] text-white'
                      : 'bg-[var(--color-surface-2)] text-[var(--color-text-dim)] hover:text-white'
                  }`}
                >
                  ${amt}
                </button>
              ))}
            </div>
            <input
              type="number"
              min="0.5"
              max={balance.balance}
              step="0.5"
              value={betSize}
              onChange={e => setBetSize(Math.max(0.5, parseFloat(e.target.value) || 1))}
              className="w-14 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-1.5 py-0.5 text-[11px] mono text-center outline-none focus:border-[#5c6bc0]"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => placeTrade('UP')}
              disabled={!canTrade}
              className="py-2.5 rounded-lg font-bold mono text-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-[#26a69a] hover:bg-[#2bbd8e] text-white active:scale-95"
            >
              BUY UP ${betSize}
              {round && <span className="block text-[10px] font-normal opacity-75">{(round.priceUp * 100).toFixed(1)}¢</span>}
            </button>
            <button
              onClick={() => placeTrade('DOWN')}
              disabled={!canTrade}
              className="py-2.5 rounded-lg font-bold mono text-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-[#ef5350] hover:bg-[#f44336] text-white active:scale-95"
            >
              BUY DOWN ${betSize}
              {round && <span className="block text-[10px] font-normal opacity-75">{(round.priceDown * 100).toFixed(1)}¢</span>}
            </button>
          </div>

          <div className="text-[10px] text-center text-[var(--color-text-dim)]">
            {!round ? 'No market' : timeLeft < 30 ? 'Too late (<30s)' : !round.acceptingOrders ? 'Closed' : 'Ready'}
            {timeLeft > 0 && ` • ${Math.floor(timeLeft / 60)}:${(timeLeft % 60).toString().padStart(2, '0')}`}
          </div>
        </>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 text-[10px]">
        <div className="text-center">
          <div className="text-[var(--color-text-dim)]">Trades</div>
          <div className="mono font-medium">{balance.totalTrades}</div>
        </div>
        <div className="text-center">
          <div className="text-[var(--color-text-dim)]">Win Rate</div>
          <div className="mono font-medium">{(balance.winRate * 100).toFixed(0)}%</div>
        </div>
        <div className="text-center">
          <div className="text-[var(--color-text-dim)]">W/L</div>
          <div className="mono"><span className="text-[#26a69a]">{balance.wins}</span>/<span className="text-[#ef5350]">{balance.losses}</span></div>
        </div>
        <div className="text-center">
          <div className="text-[var(--color-text-dim)]">P&L</div>
          <div className={`mono font-medium ${balance.totalPnl >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
            {balance.totalPnl >= 0 ? '+' : ''}${balance.totalPnl.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Trade History */}
      {history.filter(t => t.paper_result).length > 0 && (
        <div>
          <div className="text-[10px] text-[var(--color-text-dim)] mb-1">Recent Trades</div>
          <div className="space-y-0.5 max-h-28 overflow-y-auto">
            {history.filter(t => t.paper_result).slice(0, 10).map(t => (
              <div key={t.id} className="flex items-center justify-between text-[10px] mono">
                <div className="flex items-center gap-1.5">
                  <span className={t.paper_result === 'WIN' ? 'text-[#26a69a]' : 'text-[#ef5350]'}>
                    {t.paper_result === 'WIN' ? 'W' : 'L'}
                  </span>
                  <span className={t.paper_bet_direction === 'UP' ? 'text-[#26a69a]' : 'text-[#ef5350]'}>
                    {t.paper_bet_direction}
                  </span>
                  <span className="text-[var(--color-text-dim)]">${t.paper_bet_size.toFixed(2)}</span>
                  <span className="text-[var(--color-text-dim)]">@{(t.paper_entry_price * 100).toFixed(0)}¢</span>
                </div>
                <span className={`font-medium ${(t.paper_pnl ?? 0) >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
                  {(t.paper_pnl ?? 0) >= 0 ? '+' : ''}${(t.paper_pnl ?? 0).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

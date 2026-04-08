import { useState, useEffect, useCallback } from 'react';

// Types
export interface LiveData {
  btcPrice: number;
  isConnected: boolean;
  tradingMode: string;
  weights: Record<string, number>;
  signal: {
    finalScore: number;
    confidence: number;
    signals: Record<string, { name: string; score: number; confidence: number; details: Record<string, unknown> }>;
    groupScores: Record<string, number>;
    allGroupsAgree: boolean;
    timestamp: number;
  } | null;
  training: {
    roundCount: number;
    currentSlug: string;
    roundStartPrice: number;
    roundUpPrice: number;
    roundDownPrice: number;
    feeRate: number;
    spread: number;
  };
}

export interface PMRound {
  title: string;
  slug: string;
  priceUp: number;
  priceDown: number;
  endTime: number;
  startTime: number;
  active: boolean;
  closed: boolean;
  acceptingOrders: boolean;
  tokenIdUp: string;
  tokenIdDown: string;
  found?: boolean;
}

export interface StrategyRow {
  name: string;
  balance: number;
  totalPnl: number;
  wins: number;
  losses: number;
  totalTrades: number;
  winRate: number;
  maxDrawdown: number;
  score: number;
  insufficient: boolean;
}

export interface Trade {
  id: number;
  round_start_time?: string;
  created_at?: string;
  actual_result: string;
  hypothetical_decision?: string;
  decision?: string;
  strategy_name?: string;
  hypothetical_ev?: number;
  hypothetical_pnl?: number;
  hypothetical_bet_size?: number;
  bet_size?: number;
  entry_price?: number;
  exit_price?: number;
  exit_reason?: string;
  pnl?: number;
  confidence?: number;
  final_score?: number;
  polymarket_up_price?: number;
  polymarket_down_price?: number;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json() as T;
  } catch { return null; }
}

export function useApiData() {
  const [live, setLive] = useState<LiveData | null>(null);
  const [round, setRound] = useState<PMRound | null>(null);
  const [strategies, setStrategies] = useState<StrategyRow[]>([]);
  const [baselineTrades, setBaselineTrades] = useState<Trade[]>([]);
  const [allStratTrades, setAllStratTrades] = useState<Trade[]>([]);

  const refresh = useCallback(async () => {
    const [liveData, roundData, stratData, blTrades] = await Promise.all([
      fetchJson<LiveData>('/api/live-data'),
      fetchJson<PMRound>('/api/polymarket/current-round'),
      fetchJson<StrategyRow[]>('/api/strategies/leaderboard'),
      fetchJson<Trade[]>('/api/training-rounds/trades'),
    ]);
    if (liveData) setLive(liveData);
    if (roundData && roundData.found !== false) setRound(roundData);
    if (stratData) setStrategies(stratData);
    if (blTrades) setBaselineTrades(blTrades);
  }, []);

  const fetchStratTrades = useCallback(async (name: string) => {
    if (name === 'ALL') {
      // Combine baseline + all strategy trades
      const [bl, ...strats] = await Promise.all([
        fetchJson<Trade[]>('/api/training-rounds/trades'),
        ...['AGGRESSIVE', 'SELECTIVE', 'CONTRARIAN', 'TREND_FOLLOWER', 'LATE_ENTRY'].map(s =>
          fetchJson<Trade[]>(`/api/strategies/${s}/trades`)
        ),
      ]);
      const all: Trade[] = [
        ...(bl || []).map(t => ({ ...t, strategy_name: 'BASELINE' })),
        ...strats.flat().filter(Boolean) as Trade[],
      ];
      setAllStratTrades(all.sort((a, b) => (b.id || 0) - (a.id || 0)).slice(0, 30));
    } else if (name === 'BASELINE') {
      const bl = await fetchJson<Trade[]>('/api/training-rounds/trades');
      setAllStratTrades((bl || []).map(t => ({ ...t, strategy_name: 'BASELINE' })).slice(0, 20));
    } else {
      const trades = await fetchJson<Trade[]>(`/api/strategies/${name}/trades`);
      setAllStratTrades((trades || []).slice(0, 20));
    }
  }, []);

  // Fast poll: live-data only (prices) every 2s
  const refreshPrices = useCallback(async () => {
    const liveData = await fetchJson<LiveData>('/api/live-data');
    if (liveData) setLive(liveData);
  }, []);

  useEffect(() => {
    refresh(); // full refresh on mount
    const fastId = setInterval(refreshPrices, 500); // prices every 500ms
    const slowId = setInterval(refresh, 10000); // full data every 10s
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
    return () => { clearInterval(fastId); clearInterval(slowId); };
  }, [refresh, refreshPrices]);

  return { live, round, strategies, baselineTrades, allStratTrades, fetchStratTrades, refresh };
}

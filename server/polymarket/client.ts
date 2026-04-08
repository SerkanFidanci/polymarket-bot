import { getAuthHeaders, isConfigured } from './auth.js';

const CLOB_BASE = 'https://clob.polymarket.com';
const GAMMA_BASE = 'https://gamma-api.polymarket.com';

interface BtcRoundInfo {
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
  windowTimestamp: number;
}

async function fetchGamma(path: string): Promise<unknown> {
  const res = await fetch(`${GAMMA_BASE}${path}`, {
    headers: { 'User-Agent': 'PolymarketBot/1.0' },
  });
  if (!res.ok) throw new Error(`Gamma ${res.status}`);
  return res.json();
}

async function fetchClob(path: string, options: RequestInit = {}): Promise<unknown> {
  const headers = { ...getAuthHeaders(), ...(options.headers as Record<string, string> ?? {}) };
  const res = await fetch(`${CLOB_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CLOB ${res.status}: ${text}`);
  }
  return res.json();
}

// Track last logged round to prevent spam
let lastLoggedSlug = '';
let lastLoggedPriceUp = 0;
let lastLoggedPriceDown = 0;

export const polymarketClient = {
  isConfigured,

  // Find current BTC 5-minute market
  async findCurrentBtcRound(): Promise<BtcRoundInfo | null> {
    const now = Math.floor(Date.now() / 1000);
    const currentWindow = now - (now % 300);

    for (const windowTs of [currentWindow, currentWindow + 300, currentWindow - 300]) {
      const slug = `btc-updown-5m-${windowTs}`;
      try {
        const events = await fetchGamma(`/events?slug=${slug}`) as Array<{
          title: string;
          slug: string;
          startDate: string;
          endDate: string;
          markets: Array<{
            question: string;
            conditionId: string;
            active: boolean;
            closed: boolean;
            acceptingOrders: boolean;
            outcomePrices: string | string[];
            clobTokenIds: string | string[];
            outcomes: string | string[];
            bestBid: number;
            bestAsk: number;
          }>;
        }>;

        if (events.length === 0) continue;

        const event = events[0]!;
        const market = event.markets?.[0];
        if (!market) continue;
        if (market.closed || !market.active) continue;

        const prices: string[] = typeof market.outcomePrices === 'string'
          ? JSON.parse(market.outcomePrices) : (market.outcomePrices ?? []);
        const tokenIds: string[] = typeof market.clobTokenIds === 'string'
          ? JSON.parse(market.clobTokenIds) : (market.clobTokenIds ?? []);
        const outcomes: string[] = typeof market.outcomes === 'string'
          ? JSON.parse(market.outcomes) : (market.outcomes ?? []);

        const upIdx = outcomes.indexOf('Up');
        const downIdx = outcomes.indexOf('Down');
        if (upIdx === -1 || downIdx === -1 || tokenIds.length < 2) continue;

        const endTime = new Date(event.endDate).getTime();

        const round: BtcRoundInfo = {
          title: event.title,
          slug: event.slug,
          conditionId: market.conditionId,
          tokenIdUp: tokenIds[upIdx]!,
          tokenIdDown: tokenIds[downIdx]!,
          priceUp: parseFloat(prices[upIdx] ?? '0.5'),
          priceDown: parseFloat(prices[downIdx] ?? '0.5'),
          bestBid: market.bestBid ?? 0,
          bestAsk: market.bestAsk ?? 0,
          active: market.active,
          closed: market.closed,
          acceptingOrders: market.acceptingOrders,
          startTime: endTime - 300000,
          endTime,
          windowTimestamp: windowTs,
        };

        // Only log when round CHANGES (new slug)
        if (slug !== lastLoggedSlug) {
          console.log(`[Polymarket] New round: ${round.title} | Up:${round.priceUp} Down:${round.priceDown}`);
          lastLoggedSlug = slug;
        }

        return round;
      } catch {
        continue;
      }
    }

    return null;
  },

  // Get fresh prices from CLOB /midpoint (real-time, not cached)
  async refreshPrices(tokenIdUp: string, _tokenIdDown: string, _slug?: string): Promise<{ priceUp: number; priceDown: number } | null> {
    try {
      // Single request — DOWN = 1 - UP (binary market complement)
      const res = await fetch(`${CLOB_BASE}/midpoint?token_id=${tokenIdUp}`);

      let priceUp = 0.5;
      let priceDown = 0.5;

      if (res.ok) {
        const data = await res.json() as { mid: string };
        const mid = parseFloat(data.mid);
        if (mid > 0 && mid < 1) {
          priceUp = mid;
          priceDown = Math.round((1 - mid) * 1000) / 1000; // complement
        }
      }

      // Only log when price changes
      const rUp = Math.round(priceUp * 1000) / 1000;
      const rDown = Math.round(priceDown * 1000) / 1000;
      if (rUp !== lastLoggedPriceUp || rDown !== lastLoggedPriceDown) {
        console.log(`[Polymarket] Price: Up:${rUp} Down:${rDown} (CLOB midpoint)`);
        lastLoggedPriceUp = rUp;
        lastLoggedPriceDown = rDown;
      }

      return { priceUp, priceDown };
    } catch {
      return null;
    }
  },

  // Polymarket taker fee: 0.072 × p × (1-p) per share
  // Source: https://docs.polymarket.com/trading/fees
  calculateFee(price: number): number {
    return 0.072 * price * (1 - price);
  },

  // Fetch spread from CLOB book — find real liquidity near midpoint
  async getSpread(tokenIdUp: string, tokenIdDown: string): Promise<number> {
    try {
      // Use midpoint difference — more reliable than thin order books
      const [upRes, downRes] = await Promise.allSettled([
        fetch(`${CLOB_BASE}/midpoint?token_id=${tokenIdUp}`),
        fetch(`${CLOB_BASE}/midpoint?token_id=${tokenIdDown}`),
      ]);

      let priceUp = 0.5;
      let priceDown = 0.5;

      if (upRes.status === 'fulfilled' && upRes.value.ok) {
        const data = await upRes.value.json() as { mid: string };
        priceUp = parseFloat(data.mid);
      }
      if (downRes.status === 'fulfilled' && downRes.value.ok) {
        const data = await downRes.value.json() as { mid: string };
        priceDown = parseFloat(data.mid);
      }

      // Implied spread = how far from perfect complement (up + down should = 1.00)
      const spread = Math.abs((priceUp + priceDown) - 1.0);
      return spread;
    } catch {
      return 0.02;
    }
  },

  // Place FOK order
  async placeOrder(tokenId: string, price: number, size: number, side: 'BUY' | 'SELL' = 'BUY'): Promise<unknown> {
    if (!isConfigured()) throw new Error('Polymarket not configured');
    return fetchClob('/order', {
      method: 'POST',
      body: JSON.stringify({ tokenID: tokenId, price, size, side, type: 'FOK' }),
    });
  },

  // Get positions
  async getPositions(): Promise<unknown> {
    return fetchClob('/positions');
  },

  // Get balance
  async getBalance(): Promise<{ available: number }> {
    if (!isConfigured()) return { available: 0 };
    try {
      const data = await fetchClob('/balance') as { balance: string };
      return { available: parseFloat(data.balance ?? '0') };
    } catch {
      return { available: 0 };
    }
  },
};

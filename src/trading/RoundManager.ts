import { logger } from '../utils/logger.js';
import type { RoundInfo } from '../polymarket/types.js';

let currentRound: RoundInfo | null = null;
let roundHistory: RoundInfo[] = [];

export const roundManager = {
  getCurrentRound(): RoundInfo | null {
    return currentRound;
  },

  setCurrentRound(round: RoundInfo | null) {
    if (round && (!currentRound || currentRound.marketId !== round.marketId)) {
      logger.info('Round', `New round: ${round.marketId} | Up: ${round.priceUp.toFixed(4)} Down: ${round.priceDown.toFixed(4)} | Ends in ${round.timeRemaining}s`);
    }
    currentRound = round;
  },

  getTimeRemaining(): number {
    if (!currentRound) return 0;
    return Math.max(0, Math.floor((currentRound.endTime - Date.now()) / 1000));
  },

  isInEntryWindow(): boolean {
    const remaining = this.getTimeRemaining();
    return remaining >= 30 && remaining <= 270;
  },

  isIdealEntry(): boolean {
    const remaining = this.getTimeRemaining();
    return remaining >= 210 && remaining <= 270; // 30-90s into the round
  },

  completeRound(result: 'UP' | 'DOWN') {
    if (currentRound) {
      logger.info('Round', `Round completed: ${result} | Market: ${currentRound.marketId}`);
      roundHistory.push(currentRound);
      if (roundHistory.length > 100) roundHistory.shift();
      currentRound = null;
    }
  },

  getRoundHistory(): RoundInfo[] {
    return [...roundHistory];
  },

  // Poll for active market from backend
  async pollMarket(): Promise<RoundInfo | null> {
    try {
      const res = await fetch('/api/polymarket/markets');
      if (!res.ok) return null;
      const markets = await res.json() as Array<{
        id: string;
        tokens: Array<{ token_id: string; outcome: string; price: number }>;
        end_date_iso?: string;
        active: boolean;
      }>;

      if (markets.length === 0) return null;

      const market = markets[0]!;
      const upToken = market.tokens?.find((t: { outcome: string }) => t.outcome === 'Up' || t.outcome === 'Yes');
      const downToken = market.tokens?.find((t: { outcome: string }) => t.outcome === 'Down' || t.outcome === 'No');

      if (!upToken || !downToken) return null;

      const endTime = market.end_date_iso ? new Date(market.end_date_iso).getTime() : Date.now() + 300000;
      const timeRemaining = Math.max(0, Math.floor((endTime - Date.now()) / 1000));

      return {
        marketId: market.id,
        tokenIdUp: upToken.token_id,
        tokenIdDown: downToken.token_id,
        priceUp: upToken.price,
        priceDown: downToken.price,
        endTime,
        timeRemaining,
        active: market.active,
      };
    } catch {
      return null;
    }
  },
};

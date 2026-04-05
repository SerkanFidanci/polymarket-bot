export interface PolymarketMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  tokens: PolymarketToken[];
  active: boolean;
  closed: boolean;
  endDate: string;
  outcomes: string[];
}

export interface PolymarketToken {
  token_id: string;
  outcome: string;
  price: number;
}

export interface PolymarketOrder {
  id: string;
  tokenId: string;
  price: number;
  size: number;
  side: 'BUY' | 'SELL';
  type: 'FOK' | 'GTC' | 'GTD';
  status: 'OPEN' | 'FILLED' | 'PARTIAL' | 'REJECTED' | 'CANCELLED';
  filledSize: number;
  timestamp: number;
}

export interface PolymarketPosition {
  tokenId: string;
  outcome: string;
  size: number;
  avgPrice: number;
  marketId: string;
}

export interface PolymarketBalance {
  available: number;
  locked: number;
  total: number;
}

export interface RoundInfo {
  marketId: string;
  tokenIdUp: string;
  tokenIdDown: string;
  priceUp: number;
  priceDown: number;
  endTime: number;
  timeRemaining: number;
  active: boolean;
}

import { logger } from '../utils/logger.js';
import {
  BINANCE_WS_SPOT,
  BINANCE_WS_FUTURES,
  WS_RECONNECT_ATTEMPTS,
  WS_RECONNECT_DELAY,
  MAX_TRADES_BUFFER,
  MAX_KLINES_BUFFER,
  MAX_LIQUIDATIONS_BUFFER,
} from '../utils/constants.js';
import type { OrderBook, Trade, Kline, LiquidationEvent } from '../types/index.js';

type WSCallback = (data: unknown) => void;

interface StreamConnection {
  ws: WebSocket | null;
  url: string;
  reconnectAttempts: number;
  isConnected: boolean;
  listeners: Map<string, WSCallback[]>;
}

export class BinanceWS {
  private spotConnection: StreamConnection | null = null;
  private futuresConnection: StreamConnection | null = null;

  // Data buffers
  private _trades: Trade[] = [];
  private _orderBook: OrderBook = { bids: [], asks: [], timestamp: 0 };
  private _klines: Kline[] = [];
  private _liquidations: LiquidationEvent[] = [];
  private _markPrice: number = 0;
  private _fundingRate: number = 0;
  private _lastTradePrice: number = 0;

  // Event listeners
  private listeners: Map<string, WSCallback[]> = new Map();

  get trades(): Trade[] { return this._trades; }
  get orderBook(): OrderBook { return this._orderBook; }
  get klines(): Kline[] { return this._klines; }
  get liquidations(): LiquidationEvent[] { return this._liquidations; }
  get markPrice(): number { return this._markPrice; }
  get fundingRate(): number { return this._fundingRate; }
  get lastTradePrice(): number { return this._lastTradePrice; }
  get isConnected(): boolean {
    return (this.spotConnection?.isConnected ?? false) &&
           (this.futuresConnection?.isConnected ?? false);
  }

  on(event: string, callback: WSCallback) {
    const existing = this.listeners.get(event) ?? [];
    existing.push(callback);
    this.listeners.set(event, existing);
  }

  private emit(event: string, data: unknown) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (const cb of callbacks) cb(data);
    }
  }

  async connect(): Promise<void> {
    logger.info('BinanceWS', 'Connecting to Binance WebSocket streams...');

    // Pre-load historical klines (needed for EMA, RSI, MACD, BB, VWAP)
    await this.fetchHistoricalKlines();

    await Promise.all([
      this.connectSpot(),
      this.connectFutures(),
    ]);
  }

  private async fetchHistoricalKlines(): Promise<void> {
    try {
      const res = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=60');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as number[][];
      this._klines = data.map(k => ({
        openTime: k[0] as number,
        open: parseFloat(k[1] as unknown as string),
        high: parseFloat(k[2] as unknown as string),
        low: parseFloat(k[3] as unknown as string),
        close: parseFloat(k[4] as unknown as string),
        volume: parseFloat(k[5] as unknown as string),
        closeTime: k[6] as number,
      }));
      this._lastTradePrice = this._klines[this._klines.length - 1]?.close ?? 0;
      logger.info('BinanceWS', `Pre-loaded ${this._klines.length} historical 1m candles`);
    } catch (err) {
      logger.warn('BinanceWS', `Failed to fetch historical klines: ${err}`);
    }
  }

  private connectSpot(): Promise<void> {
    return new Promise((resolve) => {
      const streams = [
        'btcusdt@trade',
        'btcusdt@depth20@100ms',
        'btcusdt@kline_1m',
        'btcusdt@aggTrade',
      ].join('/');

      const url = `${BINANCE_WS_SPOT}${streams}`;

      this.spotConnection = {
        ws: null,
        url,
        reconnectAttempts: 0,
        isConnected: false,
        listeners: new Map(),
      };

      this.createWebSocket(this.spotConnection, 'spot', resolve);
    });
  }

  private connectFutures(): Promise<void> {
    return new Promise((resolve) => {
      const streams = [
        'btcusdt@markPrice@1s',
        'btcusdt@forceOrder',
      ].join('/');

      const url = `${BINANCE_WS_FUTURES}${streams}`;

      this.futuresConnection = {
        ws: null,
        url,
        reconnectAttempts: 0,
        isConnected: false,
        listeners: new Map(),
      };

      this.createWebSocket(this.futuresConnection, 'futures', resolve);
    });
  }

  private createWebSocket(conn: StreamConnection, label: string, onFirstConnect?: () => void) {
    try {
      const ws = new WebSocket(conn.url);

      ws.onopen = () => {
        conn.isConnected = true;
        conn.reconnectAttempts = 0;
        conn.ws = ws;
        logger.info('BinanceWS', `${label} stream connected`);
        this.emit('connected', label);
        if (onFirstConnect) {
          onFirstConnect();
          onFirstConnect = undefined;
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string);
          this.handleMessage(data, label);
        } catch {
          // ignore parse errors
        }
      };

      ws.onerror = () => {
        logger.error('BinanceWS', `${label} stream error`);
      };

      ws.onclose = () => {
        conn.isConnected = false;
        logger.warn('BinanceWS', `${label} stream closed`);
        this.emit('disconnected', label);
        this.attemptReconnect(conn, label);
        if (onFirstConnect) {
          onFirstConnect();
          onFirstConnect = undefined;
        }
      };
    } catch (err) {
      logger.error('BinanceWS', `Failed to create ${label} WebSocket: ${err}`);
      if (onFirstConnect) onFirstConnect();
    }
  }

  private attemptReconnect(conn: StreamConnection, label: string) {
    if (conn.reconnectAttempts >= WS_RECONNECT_ATTEMPTS) {
      logger.error('BinanceWS', `${label} max reconnect attempts reached`);
      this.emit('maxReconnectFailed', label);
      return;
    }

    conn.reconnectAttempts++;
    logger.info('BinanceWS', `${label} reconnecting (attempt ${conn.reconnectAttempts}/${WS_RECONNECT_ATTEMPTS})...`);

    setTimeout(() => {
      this.createWebSocket(conn, label);
    }, WS_RECONNECT_DELAY);
  }

  private handleMessage(data: Record<string, unknown>, _label: string) {
    // Combined stream format: { stream: "...", data: {...} }
    const streamData = (data.data ?? data) as Record<string, unknown>;
    const stream = (data.stream as string) ?? '';
    const eventType = (streamData.e as string) ?? '';

    if (stream.includes('@trade') && !stream.includes('@aggTrade')) {
      this.handleTrade(streamData);
    } else if (stream.includes('@depth')) {
      this.handleDepth(streamData);
    } else if (stream.includes('@kline')) {
      this.handleKline(streamData);
    } else if (stream.includes('@aggTrade')) {
      this.handleAggTrade(streamData);
    } else if (stream.includes('@markPrice') || eventType === 'markPriceUpdate') {
      this.handleMarkPrice(streamData);
    } else if (stream.includes('@forceOrder') || eventType === 'forceOrder') {
      this.handleLiquidation(streamData);
    }
  }

  private handleTrade(data: Record<string, unknown>) {
    const trade: Trade = {
      price: parseFloat(data.p as string),
      quantity: parseFloat(data.q as string),
      isBuyerMaker: data.m as boolean,
      timestamp: data.T as number ?? Date.now(),
    };

    this._lastTradePrice = trade.price;
    this._trades.push(trade);
    if (this._trades.length > MAX_TRADES_BUFFER) {
      this._trades = this._trades.slice(-MAX_TRADES_BUFFER);
    }

    this.emit('trade', trade);
  }

  private handleAggTrade(data: Record<string, unknown>) {
    const trade: Trade = {
      price: parseFloat(data.p as string),
      quantity: parseFloat(data.q as string),
      isBuyerMaker: data.m as boolean,
      timestamp: data.T as number ?? Date.now(),
    };

    this._lastTradePrice = trade.price;
    this._trades.push(trade);
    if (this._trades.length > MAX_TRADES_BUFFER) {
      this._trades = this._trades.slice(-MAX_TRADES_BUFFER);
    }

    this.emit('aggTrade', trade);
  }

  private handleDepth(data: Record<string, unknown>) {
    const bids = (data.bids ?? data.b) as string[][];
    const asks = (data.asks ?? data.a) as string[][];

    if (bids && asks) {
      this._orderBook = {
        bids: bids.map(([p, q]) => ({ price: parseFloat(p!), quantity: parseFloat(q!) })),
        asks: asks.map(([p, q]) => ({ price: parseFloat(p!), quantity: parseFloat(q!) })),
        timestamp: Date.now(),
      };
      this.emit('depth', this._orderBook);
    }
  }

  private handleKline(data: Record<string, unknown>) {
    const k = data.k as Record<string, unknown>;
    if (!k) return;

    const kline: Kline = {
      openTime: k.t as number,
      open: parseFloat(k.o as string),
      high: parseFloat(k.h as string),
      low: parseFloat(k.l as string),
      close: parseFloat(k.c as string),
      volume: parseFloat(k.v as string),
      closeTime: k.T as number,
    };

    // Update or append
    const lastKline = this._klines[this._klines.length - 1];
    if (lastKline && lastKline.openTime === kline.openTime) {
      this._klines[this._klines.length - 1] = kline;
    } else {
      this._klines.push(kline);
      if (this._klines.length > MAX_KLINES_BUFFER) {
        this._klines = this._klines.slice(-MAX_KLINES_BUFFER);
      }
    }

    this.emit('kline', kline);
  }

  private handleMarkPrice(data: Record<string, unknown>) {
    this._markPrice = parseFloat(data.p as string);
    this._fundingRate = parseFloat(data.r as string);
    this.emit('markPrice', { price: this._markPrice, fundingRate: this._fundingRate });
  }

  private handleLiquidation(data: Record<string, unknown>) {
    const o = (data.o ?? data) as Record<string, unknown>;
    if (!o.s) return;

    const liq: LiquidationEvent = {
      symbol: o.s as string,
      side: o.S as 'BUY' | 'SELL',
      price: parseFloat(o.p as string),
      quantity: parseFloat(o.q as string),
      timestamp: o.T as number ?? Date.now(),
    };

    this._liquidations.push(liq);
    if (this._liquidations.length > MAX_LIQUIDATIONS_BUFFER) {
      this._liquidations = this._liquidations.slice(-MAX_LIQUIDATIONS_BUFFER);
    }

    this.emit('liquidation', liq);
  }

  // Get recent trades within timeframe
  getRecentTrades(ms: number): Trade[] {
    const cutoff = Date.now() - ms;
    return this._trades.filter(t => t.timestamp >= cutoff);
  }

  // Get recent liquidations within timeframe
  getRecentLiquidations(ms: number): LiquidationEvent[] {
    const cutoff = Date.now() - ms;
    return this._liquidations.filter(l => l.timestamp >= cutoff);
  }

  // Get 1m closes for indicators
  getCloses(): number[] {
    return this._klines.map(k => k.close);
  }

  // Get 1m volumes
  getVolumes(): number[] {
    return this._klines.map(k => k.volume);
  }

  disconnect() {
    if (this.spotConnection?.ws) {
      this.spotConnection.ws.close();
      this.spotConnection.ws = null;
    }
    if (this.futuresConnection?.ws) {
      this.futuresConnection.ws.close();
      this.futuresConnection.ws = null;
    }
    logger.info('BinanceWS', 'Disconnected all streams');
  }
}

// Singleton
export const binanceWS = new BinanceWS();

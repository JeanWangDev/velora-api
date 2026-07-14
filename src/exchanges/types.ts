import type {
  CanonicalInterval,
  IExchangeMeta,
  IKline,
  IKlineTick,
  IOrderBookDepth,
  ISymbolInfo,
  ISymbolSummary,
  ITicker24h,
  ITradeTick,
} from "@/types/market";

export interface IGetKlinesParams {
  symbol: string;
  interval: CanonicalInterval;
  /** Inclusive lower bound in **milliseconds** since epoch. */
  startTime?: number;
  /** Inclusive upper bound in **milliseconds** since epoch. */
  endTime?: number;
  /** Hard cap on number of returned bars (adapter clamps to its own ceiling). */
  limit?: number;
}

export interface ISearchSymbolsParams {
  query: string;
  limit?: number;
  /** 计价币过滤，如 USDT */
  quoteAsset?: string;
}

export type KlineStreamHandler = (tick: IKlineTick) => void;
export type TradeStreamHandler = (trade: ITradeTick) => void;
export type TickerStreamHandler = (ticker: ITicker24h) => void;
export type DepthStreamHandler = (depth: IOrderBookDepth) => void;

/**
 * Handle returned by `subscribe*`. Calling `close()` removes one logical
 * subscriber; the adapter is free to keep the upstream connection alive for
 * other subscribers and tear it down only when the refcount hits zero.
 */
export interface IStreamHandle {
  close(): void;
}

export interface IExchangeRest {
  getServerTime(): Promise<number>;
  getKlines(params: IGetKlinesParams): Promise<IKline[]>;
  getTicker24h(symbol: string): Promise<ITicker24h>;
  /** 全市场 24h ticker，可按计价币过滤 */
  getTickers24h(quoteAsset?: string): Promise<ITicker24h[]>;
  getDepth(symbol: string, limit?: number): Promise<IOrderBookDepth>;
  getAggTrades(symbol: string, limit?: number): Promise<ITradeTick[]>;
  searchSymbols(params: ISearchSymbolsParams): Promise<ISymbolSummary[]>;
  getSymbolInfo(symbol: string): Promise<ISymbolInfo>;
}

export interface IExchangeWs {
  subscribeKline(
    symbol: string,
    interval: CanonicalInterval,
    onTick: KlineStreamHandler,
  ): IStreamHandle;

  /**
   * Per-trade tape stream. The frontend uses this to smoothly update the
   * forming candle's close between kline events (~100ms vs ~2/s for klines).
   */
  subscribeTrades(symbol: string, onTrade: TradeStreamHandler): IStreamHandle;

  /** Rolling 24h ticker stats (~1s cadence on Binance). */
  subscribeTicker(symbol: string, onTicker: TickerStreamHandler): IStreamHandle;

  /** L2 depth snapshot stream (e.g. depth20@100ms on Binance). */
  subscribeDepth(symbol: string, onDepth: DepthStreamHandler): IStreamHandle;
}

export interface IExchangeAdapter {
  meta: IExchangeMeta;
  rest: IExchangeRest;
  ws: IExchangeWs;
}

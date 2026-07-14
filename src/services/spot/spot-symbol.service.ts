import { config } from "@/config";
import { SpotSymbol } from "@/db";
import { BadRequestError, NotFoundError } from "@/errors/app-error";
import { listUsdtSpotMarkets } from "@/exchanges/binance/rest";
import MarketService from "@/services/market/market.service";
import { SpotSymbolSyncService } from "@/services/spot/spot-symbol-sync.service";

export interface SpotSymbolView {
  symbol: string;
  base: string;
  quote: string;
  displayName: string;
  pricePrecision: number;
  qtyPrecision: number;
  minQty: number;
  makerFee: number;
  takerFee: number;
  status: "trading" | "halt";
}

function assertDbReady() {
  if (!config.db.enabled) {
    throw new BadRequestError("数据库未启用");
  }
}

/** 前端交易对格式 BTC-USDT → 上游行情格式 BTCUSDT */
export function toUpstreamSymbol(symbol: string): string {
  return symbol.replace(/-/g, "").toUpperCase();
}

export function toSymbolView(row: SpotSymbol): SpotSymbolView {
  return {
    symbol: row.symbol,
    base: row.base,
    quote: row.quote,
    displayName: row.displayName,
    pricePrecision: row.pricePrecision,
    qtyPrecision: row.qtyPrecision,
    minQty: Number(row.minQty),
    makerFee: Number(row.makerFee),
    takerFee: Number(row.takerFee),
    status: row.status === 1 ? "trading" : "halt",
  };
}

export class SpotSymbolService {
  /** Binance USDT 现货全量（行情对接，不限制 Admin 上架数量） */
  static async list(): Promise<SpotSymbolView[]> {
    const markets = await listUsdtSpotMarkets();
    return markets.map((m) => ({
      ...m,
      makerFee: 0.001,
      takerFee: 0.001,
    }));
  }

  /** 获取单个交易对元数据；不存在时从 Binance 自动建档 */
  static async requireTrading(symbol: string): Promise<SpotSymbol> {
    assertDbReady();
    const upper = symbol.toUpperCase();
    let row = await SpotSymbol.findOne({ where: { symbol: upper } });
    if (!row) {
      await SpotSymbolSyncService.upsertFromVeloraSymbol(upper);
      row = await SpotSymbol.findOne({ where: { symbol: upper } });
    }
    if (!row) {
      throw new NotFoundError("交易对不存在");
    }
    if (row.status !== 1) {
      throw new BadRequestError("该交易对已停牌");
    }
    return row;
  }

  /** 获取实时最新价（来自上游行情） */
  static async getLastPrice(symbol: string): Promise<number> {
    const ticker = await MarketService.getTicker24h({
      exchange: "binance",
      symbol: toUpstreamSymbol(symbol),
    });
    const price = Number(ticker.lastPrice);
    if (!(price > 0)) {
      throw new BadRequestError("暂时无法获取行情价，请稍后再试");
    }
    return price;
  }
}

import { config } from "@/config";
import { SpotSymbol } from "@/db";
import { BadRequestError, NotFoundError } from "@/errors/app-error";
import MarketService from "@/services/market/market.service";

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
  /** 上架中的现货交易对列表 */
  static async list(): Promise<SpotSymbolView[]> {
    assertDbReady();
    const rows = await SpotSymbol.findAll({
      where: { status: 1 },
      order: [
        ["sortOrder", "ASC"],
        ["id", "ASC"],
      ],
    });
    return rows.map(toSymbolView);
  }

  /** 获取单个交易对元数据（不存在/停牌抛错） */
  static async requireTrading(symbol: string): Promise<SpotSymbol> {
    assertDbReady();
    const row = await SpotSymbol.findOne({ where: { symbol: symbol.toUpperCase() } });
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

import { Op } from "sequelize";
import { SpotOrder, SpotTrade } from "@/db";
import MarketService from "@/services/market/market.service";
import { SpotSymbolService, toUpstreamSymbol } from "@/services/spot/spot-symbol.service";
import { roundAmount } from "@/services/account";

export interface OrderBookLevel {
  price: number;
  quantity: number;
  source: "internal" | "external";
}

export interface MergedOrderBook {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  lastPrice: number;
  ts: number;
}

function aggregateLevels(
  orders: SpotOrder[],
  side: "buy" | "sell",
): Map<number, number> {
  const map = new Map<number, number>();
  for (const o of orders) {
    if (o.side !== side || !o.price) continue;
    const remaining = roundAmount(Number(o.quantity) - Number(o.filledQuantity));
    if (remaining <= 0) continue;
    const price = Number(o.price);
    map.set(price, roundAmount((map.get(price) ?? 0) + remaining));
  }
  return map;
}

function mapToLevels(
  map: Map<number, number>,
  side: "buy" | "sell",
  source: "internal" | "external",
  limit: number,
): OrderBookLevel[] {
  const entries = [...map.entries()].map(([price, quantity]) => ({
    price,
    quantity,
    source,
  }));
  entries.sort((a, b) => (side === "buy" ? b.price - a.price : a.price - b.price));
  return entries.slice(0, limit);
}

function mergeSide(
  internal: OrderBookLevel[],
  external: OrderBookLevel[],
  side: "buy" | "sell",
  limit: number,
): OrderBookLevel[] {
  const merged = new Map<number, OrderBookLevel>();
  for (const lvl of [...internal, ...external]) {
    const existing = merged.get(lvl.price);
    if (existing) {
      existing.quantity = roundAmount(existing.quantity + lvl.quantity);
      if (existing.source !== lvl.source) existing.source = "internal";
    } else {
      merged.set(lvl.price, { ...lvl });
    }
  }
  const list = [...merged.values()];
  list.sort((a, b) => (side === "buy" ? b.price - a.price : a.price - b.price));
  return list.slice(0, limit);
}

export class SpotOrderBookService {
  /** OKX 风格：内部 CLOB 挂单深度 + 外部流动性深度合并展示 */
  static async getMergedBook(symbol: string, limit = 50): Promise<MergedOrderBook> {
    const meta = await SpotSymbolService.requireTrading(symbol);
    const upstream = toUpstreamSymbol(symbol);

    const [openOrders, external, lastPrice] = await Promise.all([
      SpotOrder.findAll({
        where: {
          symbol: meta.symbol,
          status: { [Op.in]: ["open", "partial"] },
          type: "limit",
        },
      }),
      MarketService.getDepth({ symbol: upstream, limit }),
      SpotSymbolService.getLastPrice(symbol),
    ]);

    const bidInternal = mapToLevels(
      aggregateLevels(openOrders, "buy"),
      "buy",
      "internal",
      limit,
    );
    const askInternal = mapToLevels(
      aggregateLevels(openOrders, "sell"),
      "sell",
      "internal",
      limit,
    );

    const bidExternal: OrderBookLevel[] = external.bids.map((l) => ({
      price: l.price,
      quantity: l.quantity,
      source: "external" as const,
    }));
    const askExternal: OrderBookLevel[] = external.asks.map((l) => ({
      price: l.price,
      quantity: l.quantity,
      source: "external" as const,
    }));

    return {
      symbol: meta.symbol,
      bids: mergeSide(bidInternal, bidExternal, "buy", limit),
      asks: mergeSide(askInternal, askExternal, "sell", limit),
      lastPrice,
      ts: Date.now(),
    };
  }

  /** 最近成交：优先内部成交，补充外部 aggTrade 由前端 WS 提供 */
  static async getRecentInternalTrades(symbol: string, limit = 50) {
    const rows = await SpotTrade.findAll({
      where: { symbol: symbol.toUpperCase() },
      order: [["id", "DESC"]],
      limit,
    });
    return rows.map((t) => ({
      id: t.tradeNo,
      price: Number(t.price),
      quantity: Number(t.quantity),
      side: t.side as "buy" | "sell",
      ts: t.createTime.getTime(),
      source: "internal" as const,
    }));
  }
}

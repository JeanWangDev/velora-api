import type { SpotOrder, SpotTrade } from "@/db";

export interface SpotOrderDto {
  orderNo: string;
  symbol: string;
  side: string;
  type: string;
  timeInForce: string;
  price: number | null;
  quantity: number;
  filledQuantity: number;
  avgPrice: number;
  quoteSpent: number;
  fee: number;
  feeCurrency: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface SpotTradeDto {
  tradeNo: string;
  orderNo: string;
  symbol: string;
  side: string;
  price: number;
  quantity: number;
  fee: number;
  feeCurrency: string;
  role: string;
  ts: number;
}

export function toSpotOrderDto(row: SpotOrder): SpotOrderDto {
  return {
    orderNo: row.orderNo,
    symbol: row.symbol,
    side: row.side,
    type: row.type,
    timeInForce: row.timeInForce ?? "gtc",
    price: row.price === null ? null : Number(row.price),
    quantity: Number(row.quantity),
    filledQuantity: Number(row.filledQuantity),
    avgPrice: Number(row.avgPrice),
    quoteSpent: Number(row.quoteSpent),
    fee: Number(row.fee),
    feeCurrency: row.feeCurrency,
    status: row.status,
    createdAt: row.createTime.getTime(),
    updatedAt: row.updateTime.getTime(),
  };
}

export function toSpotTradeDto(row: SpotTrade): SpotTradeDto {
  return {
    tradeNo: row.tradeNo,
    orderNo: row.orderNo,
    symbol: row.symbol,
    side: row.side,
    price: Number(row.price),
    quantity: Number(row.quantity),
    fee: Number(row.fee),
    feeCurrency: row.feeCurrency,
    role: row.role,
    ts: row.createTime.getTime(),
  };
}

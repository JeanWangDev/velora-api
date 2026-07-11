import { QueryTypes } from "sequelize";
import { config } from "@/config";
import { getSequelize } from "@/db/connection";
import { BadRequestError } from "@/errors/app-error";

export interface FuturesSymbolView {
  symbol: string;
  base: string;
  quote: string;
  contractValue: number;
  pricePrecision: number;
  qtyPrecision: number;
  minQty: number;
  maxLeverage: number;
  makerFee: number;
  takerFee: number;
  fundingIntervalHours: number;
  status: "trading" | "halt";
}

export class FuturesSymbolService {
  static async list(): Promise<FuturesSymbolView[]> {
    const sequelize = await getSequelize();
    if (!sequelize) return [];

    const rows = await sequelize.query<{
      symbol: string;
      base: string;
      quote: string;
      contractValue: string;
      pricePrecision: number;
      qtyPrecision: number;
      minQty: string;
      maxLeverage: number;
      makerFee: string;
      takerFee: string;
      fundingIntervalHours: number;
      status: number;
    }>(
      `SELECT f_symbol AS symbol, f_base AS base, f_quote AS quote,
              f_contract_value AS contractValue, f_price_precision AS pricePrecision,
              f_qty_precision AS qtyPrecision, f_min_qty AS minQty,
              f_max_leverage AS maxLeverage, f_maker_fee AS makerFee, f_taker_fee AS takerFee,
              f_funding_interval_hours AS fundingIntervalHours, f_status AS status
       FROM t_futures_symbol WHERE f_status = 1 ORDER BY f_sort_order ASC`,
      { type: QueryTypes.SELECT },
    );

    return rows.map((r) => ({
      symbol: r.symbol,
      base: r.base,
      quote: r.quote,
      contractValue: Number(r.contractValue),
      pricePrecision: r.pricePrecision,
      qtyPrecision: r.qtyPrecision,
      minQty: Number(r.minQty),
      maxLeverage: r.maxLeverage,
      makerFee: Number(r.makerFee),
      takerFee: Number(r.takerFee),
      fundingIntervalHours: r.fundingIntervalHours,
      status: r.status === 1 ? "trading" : "halt",
    }));
  }

  static async requireTrading(symbol: string): Promise<FuturesSymbolView> {
    const list = await this.list();
    const found = list.find((s) => s.symbol === symbol.toUpperCase());
    if (!found) throw new BadRequestError(`合约 ${symbol} 不存在或未开放`);
    return found;
  }

  /** 现货指数价作为标记价格 */
  static spotIndexSymbol(futuresSymbol: string): string {
    return futuresSymbol.replace("-SWAP", "").replace(/-USDT-SWAP$/, "-USDT");
  }
}

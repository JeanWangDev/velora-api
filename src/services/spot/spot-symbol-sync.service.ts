import { config } from "@/config";
import { SpotSymbol, TradingSymbol } from "@/db";
import { BadRequestError } from "@/errors/app-error";
import MarketService from "@/services/market/market.service";
import type { TradingPairRecord } from "@/services/market/trading-symbol.service";
import { getBinanceMinQty } from "@/exchanges/binance/rest";

const ACTIVE = 1;

/** Binance BTCUSDT → Velora BTC-USDT */
export function upstreamToVeloraSymbol(baseAsset: string, upstreamSymbol: string): string {
  const upper = upstreamSymbol.trim().toUpperCase();
  const base = baseAsset.trim().toUpperCase();
  if (upper.startsWith(base) && upper.length > base.length) {
    return `${base}-${upper.slice(base.length)}`;
  }
  const quotes = ["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "BTC", "ETH", "BNB"];
  for (const q of quotes) {
    if (upper.endsWith(q) && upper.length > q.length) {
      return `${upper.slice(0, -q.length)}-${q}`;
    }
  }
  return upper;
}

function mapTradingRow(row: TradingSymbol): TradingPairRecord {
  return {
    id: row.id,
    baseAsset: row.baseAsset,
    symbol: row.symbol,
    exchange: row.exchange,
    displayName: row.displayName || row.baseAsset,
    sortOrder: row.sortOrder,
    isDefault: row.isDefault === 1,
    status: row.status,
  };
}

export class SpotSymbolSyncService {
  /** 从 Velora 格式交易对（BTC-USDT）同步 Binance 元数据 */
  static async upsertFromVeloraSymbol(veloraSymbol: string): Promise<void> {
    if (!config.db.enabled) return;

    const upper = veloraSymbol.trim().toUpperCase();
    const upstream = upper.replace(/-/g, "");
    const info = await MarketService.getSymbolInfo({ exchange: "binance", symbol: upstream });
    const minQty = await getBinanceMinQty(upstream);
    const now = new Date();

    const payload = {
      symbol: upper,
      base: info.baseAsset,
      quote: info.quoteAsset,
      displayName: info.baseAsset,
      pricePrecision: info.pricePrecision,
      qtyPrecision: info.quantityPrecision,
      minQty: String(minQty > 0 ? minQty : Math.pow(10, -info.quantityPrecision)),
      sortOrder: 0,
      status: 1,
      updateTime: now,
    };

    const existing = await SpotSymbol.findOne({ where: { symbol: upper } });
    if (existing) {
      await existing.update(payload);
      return;
    }

    await SpotSymbol.create({
      ...payload,
      makerFee: "0.001",
      takerFee: "0.001",
      createTime: now,
    });
  }

  /** 从 Binance exchangeInfo 同步单个上架对 → t_spot_symbol */
  static async upsertFromTradingPair(pair: TradingPairRecord): Promise<void> {
    if (!config.db.enabled) return;

    const exchange = (pair.exchange || "binance").trim().toLowerCase();
    if (exchange !== "binance") {
      throw new BadRequestError("当前仅支持从 Binance 同步现货元数据");
    }

    const upstream = pair.symbol.trim().toUpperCase();
    const veloraSymbol = upstreamToVeloraSymbol(pair.baseAsset, upstream);

    const info = await MarketService.getSymbolInfo({ exchange, symbol: upstream });
    const minQty = await getBinanceMinQty(upstream);

    const now = new Date();
    const payload = {
      symbol: veloraSymbol,
      base: info.baseAsset,
      quote: info.quoteAsset,
      displayName: (pair.displayName || info.description).trim() || info.baseAsset,
      pricePrecision: info.pricePrecision,
      qtyPrecision: info.quantityPrecision,
      minQty: String(minQty > 0 ? minQty : Math.pow(10, -info.quantityPrecision)),
      sortOrder: pair.sortOrder,
      status: pair.status === ACTIVE ? 1 : 0,
      updateTime: now,
    };

    const existing = await SpotSymbol.findOne({ where: { symbol: veloraSymbol } });
    if (existing) {
      await existing.update(payload);
      return;
    }

    await SpotSymbol.create({
      ...payload,
      makerFee: "0.001",
      takerFee: "0.001",
      createTime: now,
    });
  }

  /** 下架时同步停用现货对 */
  static async disableForTradingPair(pair: TradingPairRecord): Promise<void> {
    if (!config.db.enabled) return;
    const velora = upstreamToVeloraSymbol(pair.baseAsset, pair.symbol);
    await SpotSymbol.update(
      { status: 0, updateTime: new Date() },
      { where: { symbol: velora } },
    );
  }

  /** 补齐 t_trading_symbol 中已上架但 t_spot_symbol 缺失的币对 */
  static async ensureSyncedFromTradingPairs(): Promise<void> {
    if (!config.db.enabled) return;

    const rows = await TradingSymbol.findAll({
      where: { status: ACTIVE },
      order: [
        ["sortOrder", "ASC"],
        ["id", "ASC"],
      ],
    });
    if (rows.length === 0) return;

    const spotRows = await SpotSymbol.findAll({ attributes: ["symbol"] });
    const existing = new Set(spotRows.map((r) => r.symbol));

    for (const row of rows) {
      const pair = mapTradingRow(row);
      const velora = upstreamToVeloraSymbol(pair.baseAsset, pair.symbol);
      if (existing.has(velora)) continue;
      try {
        await SpotSymbolSyncService.upsertFromTradingPair(pair);
        existing.add(velora);
      } catch (error) {
        console.warn(
          `[spot-sync] skip ${pair.symbol}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  /** Admin：全量从 Binance 刷新已上架现货元数据 */
  static async syncAllActive(): Promise<{ synced: number; failed: string[] }> {
    if (!config.db.enabled) {
      throw new BadRequestError("数据库未启用");
    }

    const rows = await TradingSymbol.findAll({
      where: { status: ACTIVE },
      order: [
        ["sortOrder", "ASC"],
        ["id", "ASC"],
      ],
    });

    let synced = 0;
    const failed: string[] = [];

    for (const row of rows) {
      const pair = mapTradingRow(row);
      try {
        await SpotSymbolSyncService.upsertFromTradingPair(pair);
        synced += 1;
      } catch (error) {
        failed.push(
          `${pair.symbol}: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
    }

    return { synced, failed };
  }
}

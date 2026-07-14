import { QueryTypes } from "sequelize";
import { getSequelize } from "@/db/connection";
import { BadRequestError } from "@/errors/app-error";
import { FuturesSymbolService } from "@/services/futures/futures-symbol.service";

export class FuturesPreferenceService {
  static async get(userId: number, symbol: string) {
    const sequelize = await getSequelize();
    if (!sequelize) {
      return { symbol, leverage: 10, marginMode: "cross" as const };
    }
    const rows = await sequelize.query<{
      leverage: number;
      marginMode: string;
    }>(
      `SELECT f_leverage AS leverage, f_margin_mode AS marginMode
       FROM t_futures_preference WHERE f_user_id = :userId AND f_symbol = :symbol LIMIT 1`,
      {
        replacements: { userId, symbol: symbol.toUpperCase() },
        type: QueryTypes.SELECT,
      },
    );
    return {
      symbol: symbol.toUpperCase(),
      leverage: rows[0]?.leverage ?? 10,
      marginMode: (rows[0]?.marginMode ?? "cross") as "cross" | "isolated",
    };
  }

  static async setLeverage(userId: number, symbol: string, leverage: number) {
    const meta = await FuturesSymbolService.requireTrading(symbol);
    if (leverage < 1 || leverage > meta.maxLeverage) {
      throw new BadRequestError(`杠杆需在 1 ~ ${meta.maxLeverage}x`);
    }
    await this.upsert(userId, meta.symbol, { leverage });
    return this.get(userId, meta.symbol);
  }

  static async setMarginMode(
    userId: number,
    symbol: string,
    marginMode: "cross" | "isolated",
  ) {
    const meta = await FuturesSymbolService.requireTrading(symbol);
    await this.upsert(userId, meta.symbol, { marginMode });
    return this.get(userId, meta.symbol);
  }

  private static async upsert(
    userId: number,
    symbol: string,
    patch: { leverage?: number; marginMode?: "cross" | "isolated" },
  ) {
    const sequelize = await getSequelize();
    if (!sequelize) throw new BadRequestError("数据库未启用");
    const current = await this.get(userId, symbol);
    await sequelize.query(
      `INSERT INTO t_futures_preference (f_user_id, f_symbol, f_leverage, f_margin_mode)
       VALUES (:userId, :symbol, :leverage, :marginMode)
       ON DUPLICATE KEY UPDATE
         f_leverage = VALUES(f_leverage),
         f_margin_mode = VALUES(f_margin_mode)`,
      {
        replacements: {
          userId,
          symbol,
          leverage: patch.leverage ?? current.leverage,
          marginMode: patch.marginMode ?? current.marginMode,
        },
      },
    );
  }
}

import { QueryTypes } from "sequelize";
import { config } from "@/config";
import { getSequelize } from "@/db/connection";
import { BadRequestError, NotFoundError } from "@/errors/app-error";
import {
  AccountService,
  roundAmount,
  type AccountType,
} from "@/services/account/account.service";
import { SpotSymbolService } from "@/services/spot/spot-symbol.service";
import { FuturesSymbolService } from "@/services/futures/futures-symbol.service";
import { FuturesEngineService } from "@/services/futures/futures-engine.service";
import { NotificationService } from "@/services/notification/notification.service";

function genNo(prefix: string) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

export class RiskService {
  static async checkSpotOrder(userId: number, symbol: string, quantity: number, price: number) {
    const sequelize = await getSequelize();
    if (!sequelize) return;

    const last = await SpotSymbolService.getLastPrice(symbol);
    const notional = roundAmount(quantity * (price || last));

    const limits = await sequelize.query<{
      singleOrderUsd: string;
      ordersPerMinute: number;
      dailyVolumeUsd: string;
    }>(
      `SELECT f_single_order_usd AS singleOrderUsd, f_orders_per_minute AS ordersPerMinute,
              f_daily_volume_usd AS dailyVolumeUsd
       FROM t_risk_limit WHERE f_role_key = 'normal_user' LIMIT 1`,
      { type: QueryTypes.SELECT },
    );
    const limit = limits[0];
    if (limit && notional > Number(limit.singleOrderUsd)) {
      throw new BadRequestError(`单笔订单超过限额 ${limit.singleOrderUsd} USD`);
    }

    const recent = await sequelize.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM t_spot_order
       WHERE f_user_id = :userId AND f_create_time > DATE_SUB(NOW(), INTERVAL 1 MINUTE)`,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
    if (limit && Number(recent[0]?.cnt ?? 0) >= limit.ordersPerMinute) {
      throw new BadRequestError("下单频率过高，请稍后再试");
    }

    const daily = await sequelize.query<{ vol: string }>(
      `SELECT COALESCE(SUM(f_price * f_quantity), 0) AS vol FROM t_spot_trade
       WHERE f_user_id = :userId AND f_create_time > DATE_SUB(NOW(), INTERVAL 1 DAY)`,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
    if (limit && Number(daily[0]?.vol ?? 0) + notional > Number(limit.dailyVolumeUsd)) {
      throw new BadRequestError(`超过日交易限额 ${limit.dailyVolumeUsd} USD`);
    }
  }

  static async checkFuturesOrder(
    userId: number,
    symbol: string,
    quantity: number,
    price: number,
  ) {
    const sequelize = await getSequelize();
    if (!sequelize) return;

    const notional = roundAmount(quantity * price);
    const limits = await sequelize.query<{ singleOrderUsd: string }>(
      `SELECT f_single_order_usd AS singleOrderUsd FROM t_risk_limit
       WHERE f_role_key = 'normal_user' LIMIT 1`,
      { type: QueryTypes.SELECT },
    );
    const limit = limits[0];
    if (limit && notional > Number(limit.singleOrderUsd)) {
      throw new BadRequestError(`合约单笔名义价值超过限额`);
    }

    const recent = await sequelize.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM t_futures_order
       WHERE f_user_id = :userId AND f_create_time > DATE_SUB(NOW(), INTERVAL 1 MINUTE)`,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
    if (Number(recent[0]?.cnt ?? 0) >= 30) {
      throw new BadRequestError("合约下单频率过高");
    }
  }
}

export class FuturesOrderService {
  static async placeOrder(input: {
    userId: number;
    symbol: string;
    side: "buy" | "sell";
    posSide: "long" | "short";
    type: "limit" | "market";
    price: number | null;
    quantity: number;
    leverage: number;
    marginMode: "cross" | "isolated";
    reduceOnly?: boolean;
  }) {
    if (!config.db.enabled) throw new BadRequestError("数据库未启用");

    const meta = await FuturesSymbolService.requireTrading(input.symbol);
    const qty = roundAmount(input.quantity);
    if (!(qty > 0)) throw new BadRequestError("数量无效");
    if (qty < meta.minQty) throw new BadRequestError(`低于最小张数 ${meta.minQty}`);

    const mark = await FuturesEngineService.getMarkPrice(input.symbol);
    const orderPrice =
      input.type === "market" ? mark : roundAmount(Number(input.price));
    if (!(orderPrice > 0)) throw new BadRequestError("价格无效");

    await RiskService.checkFuturesOrder(input.userId, input.symbol, qty, orderPrice);

    const margin = roundAmount((orderPrice * qty) / input.leverage);
    const orderNo = genNo("FO");
    const reduceOnly = Boolean(input.reduceOnly);

    if (reduceOnly) {
      const positions = await this.listPositions(input.userId);
      const pos = (positions as { symbol: string; side: string; quantity: number }[]).find(
        (p) =>
          p.symbol === input.symbol &&
          p.side === input.posSide &&
          Number(p.quantity) >= qty,
      );
      if (!pos) throw new BadRequestError("可平仓位不足");
    }

    await AccountService.runInTransaction(async (tx) => {
      if (!reduceOnly) {
        const avail = await AccountService.getAvailable(
          input.userId,
          "USDT",
          tx,
          "futures" as AccountType,
        );
        if (avail < margin) throw new BadRequestError("合约账户保证金不足");

        await AccountService.adjust(
          {
            userId: input.userId,
            currency: "USDT",
            accountType: "futures",
            availableDelta: -margin,
            frozenDelta: margin,
            ledgerType: "freeze",
            ledgerAmount: -margin,
            refId: orderNo,
          },
          tx,
        );
      }

      const sequelize = await getSequelize();
      const status = input.type === "market" ? "open" : "open";
      await sequelize!.query(
        `INSERT INTO t_futures_order
          (f_order_no, f_user_id, f_symbol, f_side, f_pos_side, f_type, f_price, f_quantity,
           f_leverage, f_margin_mode, f_reduce_only, f_status)
         VALUES (:orderNo, :userId, :symbol, :side, :posSide, :type, :price, :qty,
                 :leverage, :marginMode, :reduceOnly, :status)`,
        {
          replacements: {
            orderNo,
            userId: input.userId,
            symbol: input.symbol,
            side: input.side,
            posSide: input.posSide,
            type: input.type,
            price: orderPrice,
            qty,
            leverage: input.leverage,
            marginMode: input.marginMode,
            reduceOnly: reduceOnly ? 1 : 0,
            status,
          },
          transaction: tx,
        },
      );
    });

    const rows = await this.getOrderByNo(input.userId, orderNo);
    if (input.type === "market" && rows) {
      await AccountService.runInTransaction(async (tx) => {
        await FuturesEngineService.fillOrder(rows, mark, qty, tx);
      });
    }

    const final = await this.getOrderByNo(input.userId, orderNo);
    return {
      orderNo,
      status: (final?.status ?? "open") as string,
      avgPrice: Number(final?.price ?? orderPrice),
    };
  }

  static async cancelOrder(userId: number, orderNo: string) {
    const sequelize = await getSequelize();
    if (!sequelize) throw new BadRequestError("数据库未启用");

    const rows = await sequelize.query<{
      orderNo: string;
      status: string;
      price: string;
      quantity: string;
      filledQuantity: string;
      leverage: number;
      reduceOnly: number;
    }>(
      `SELECT f_order_no AS orderNo, f_status AS status, f_price AS price,
              f_quantity AS quantity, f_filled_quantity AS filledQuantity,
              f_leverage AS leverage, f_reduce_only AS reduceOnly
       FROM t_futures_order WHERE f_user_id = :userId AND f_order_no = :orderNo LIMIT 1`,
      { replacements: { userId, orderNo }, type: QueryTypes.SELECT },
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("订单不存在");
    if (row.status !== "open" && row.status !== "partial") {
      throw new BadRequestError("订单不可撤销");
    }

    const remain = roundAmount(Number(row.quantity) - Number(row.filledQuantity));
    const frozenMargin = row.reduceOnly
      ? 0
      : roundAmount((Number(row.price) * remain) / row.leverage);

    await AccountService.runInTransaction(async (tx) => {
      if (frozenMargin > 0) {
        await AccountService.adjust(
          {
            userId,
            currency: "USDT",
            accountType: "futures",
            availableDelta: frozenMargin,
            frozenDelta: -frozenMargin,
            ledgerType: "unfreeze",
            ledgerAmount: frozenMargin,
            refId: orderNo,
          },
          tx,
        );
      }
      await sequelize.query(
        `UPDATE t_futures_order SET f_status = 'cancelled' WHERE f_order_no = :orderNo`,
        { replacements: { orderNo }, transaction: tx },
      );
    });

    return { orderNo, status: "cancelled" as const };
  }

  static async listOpenOrders(userId: number, symbol?: string) {
    const sequelize = await getSequelize();
    if (!sequelize) return [];
    const symFilter = symbol ? "AND f_symbol = :symbol" : "";
    return sequelize.query(
      `SELECT f_order_no AS orderNo, f_symbol AS symbol, f_side AS side, f_pos_side AS posSide,
              f_type AS type, f_price AS price, f_quantity AS quantity,
              f_filled_quantity AS filledQuantity, f_leverage AS leverage,
              f_margin_mode AS marginMode, f_reduce_only AS reduceOnly, f_status AS status,
              UNIX_TIMESTAMP(f_create_time)*1000 AS createdAt
       FROM t_futures_order WHERE f_user_id = :userId AND f_status IN ('open','partial')
       ${symFilter} ORDER BY f_id DESC`,
      { replacements: { userId, symbol }, type: QueryTypes.SELECT },
    );
  }

  static async listOrderHistory(userId: number, page = 1, pageSize = 50, symbol?: string) {
    const sequelize = await getSequelize();
    if (!sequelize) return { rows: [], total: 0 };
    const offset = (page - 1) * pageSize;
    const symFilter = symbol ? "AND f_symbol = :symbol" : "";
    const rows = await sequelize.query(
      `SELECT f_order_no AS orderNo, f_symbol AS symbol, f_side AS side, f_pos_side AS posSide,
              f_type AS type, f_price AS price, f_quantity AS quantity,
              f_filled_quantity AS filledQuantity, f_status AS status,
              UNIX_TIMESTAMP(f_create_time)*1000 AS createdAt
       FROM t_futures_order WHERE f_user_id = :userId ${symFilter}
       ORDER BY f_id DESC LIMIT :limit OFFSET :offset`,
      { replacements: { userId, symbol, limit: pageSize, offset }, type: QueryTypes.SELECT },
    );
    const total = await sequelize.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM t_futures_order WHERE f_user_id = :userId ${symFilter}`,
      { replacements: { userId, symbol }, type: QueryTypes.SELECT },
    );
    return { rows, total: total[0]?.cnt ?? 0, page, pageSize };
  }

  static async listPositions(userId: number) {
    const sequelize = await getSequelize();
    if (!sequelize) return [];

    await FuturesEngineService.updateUnrealizedPnl();

    return sequelize.query(
      `SELECT f_symbol AS symbol, f_side AS side, f_margin_mode AS marginMode,
              f_leverage AS leverage, f_quantity AS quantity, f_entry_price AS entryPrice,
              f_margin AS margin, f_unrealized_pnl AS unrealizedPnl,
              f_liquidation_price AS liquidationPrice,
              (SELECT f_mark_price FROM t_futures_symbol s WHERE s.f_symbol = p.f_symbol) AS markPrice
       FROM t_futures_position p
       WHERE f_user_id = :userId AND f_status = 'open' AND f_quantity > 0`,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
  }

  static async listMarkPrices() {
    const sequelize = await getSequelize();
    if (!sequelize) return [];
    return sequelize.query(
      `SELECT f_symbol AS symbol, f_mark_price AS markPrice, f_index_price AS indexPrice,
              f_funding_rate AS fundingRate, f_funding_interval_hours AS fundingIntervalHours,
              UNIX_TIMESTAMP(f_last_funding_at)*1000 AS lastFundingAt
       FROM t_futures_symbol WHERE f_status = 1`,
      { type: QueryTypes.SELECT },
    );
  }

  private static async getOrderByNo(userId: number, orderNo: string) {
    const sequelize = await getSequelize();
    if (!sequelize) return null;
    const rows = await sequelize.query(
      `SELECT f_id AS id, f_order_no AS orderNo, f_user_id AS userId, f_symbol AS symbol,
              f_side AS side, f_pos_side AS posSide, f_type AS type, f_price AS price,
              f_quantity AS quantity, f_filled_quantity AS filledQuantity,
              f_leverage AS leverage, f_margin_mode AS marginMode, f_reduce_only AS reduceOnly,
              f_status AS status
       FROM t_futures_order WHERE f_user_id = :userId AND f_order_no = :orderNo LIMIT 1`,
      { replacements: { userId, orderNo }, type: QueryTypes.SELECT },
    );
    return (rows[0] ?? null) as import("@/services/futures/futures-engine.service").FuturesOrderRow | null;
  }
}

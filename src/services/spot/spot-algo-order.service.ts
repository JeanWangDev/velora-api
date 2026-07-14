import { QueryTypes } from "sequelize";
import { config } from "@/config";
import { getSequelize } from "@/db/connection";
import { BadRequestError } from "@/errors/app-error";
import { SpotOrderService } from "@/services/spot/spot-order.service";
import { SpotSymbolService } from "@/services/spot/spot-symbol.service";
import { NotificationService } from "@/services/notification/notification.service";

function genNo(prefix: string) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

export type AlgoType = "stop_loss" | "take_profit" | "trailing_stop" | "oco";

export class SpotAlgoOrderService {
  static async place(input: {
    userId: number;
    symbol: string;
    side: "buy" | "sell";
    algoType: AlgoType;
    triggerPrice: number;
    orderPrice: number | null;
    quantity: number;
    callbackRate?: number;
    groupNo?: string;
  }) {
    if (!config.db.enabled) throw new BadRequestError("数据库未启用");
    await SpotSymbolService.requireTrading(input.symbol);

    if (input.algoType === "trailing_stop") {
      const rate = Number(input.callbackRate);
      if (!(rate > 0 && rate < 1)) {
        throw new BadRequestError("移动止盈回撤比例需在 0~1 之间，如 0.02 = 2%");
      }
    }

    const algoNo = genNo("AL");
    const last = await SpotSymbolService.getLastPrice(input.symbol);
    const sequelize = await getSequelize();
    await sequelize!.query(
      `INSERT INTO t_spot_algo_order
        (f_algo_no, f_user_id, f_symbol, f_side, f_algo_type, f_trigger_price, f_order_price,
         f_quantity, f_callback_rate, f_peak_price, f_group_no)
       VALUES (:algoNo, :userId, :symbol, :side, :algoType, :triggerPrice, :orderPrice,
               :quantity, :callbackRate, :peakPrice, :groupNo)`,
      {
        replacements: {
          algoNo,
          userId: input.userId,
          symbol: input.symbol.toUpperCase(),
          side: input.side,
          algoType: input.algoType,
          triggerPrice: input.triggerPrice,
          orderPrice: input.orderPrice,
          quantity: input.quantity,
          callbackRate: input.callbackRate ?? null,
          peakPrice: input.algoType === "trailing_stop" ? last : null,
          groupNo: input.groupNo ?? "",
        },
      },
    );
    return { algoNo, status: "active" as const };
  }

  /** OCO：止盈 + 止损一组，触发其一则取消另一侧 */
  static async placeOco(input: {
    userId: number;
    symbol: string;
    side: "buy" | "sell";
    quantity: number;
    takeProfitTrigger: number;
    stopLossTrigger: number;
    takeProfitOrderPrice?: number | null;
    stopLossOrderPrice?: number | null;
  }) {
    const groupNo = genNo("OCO");
    const tp = await this.place({
      userId: input.userId,
      symbol: input.symbol,
      side: input.side,
      algoType: "take_profit",
      triggerPrice: input.takeProfitTrigger,
      orderPrice: input.takeProfitOrderPrice ?? null,
      quantity: input.quantity,
      groupNo,
    });
    const sl = await this.place({
      userId: input.userId,
      symbol: input.symbol,
      side: input.side,
      algoType: "stop_loss",
      triggerPrice: input.stopLossTrigger,
      orderPrice: input.stopLossOrderPrice ?? null,
      quantity: input.quantity,
      groupNo,
    });
    return { groupNo, takeProfitAlgoNo: tp.algoNo, stopLossAlgoNo: sl.algoNo };
  }

  static async listActive(userId: number, symbol?: string) {
    const sequelize = await getSequelize();
    if (!sequelize) return [];
    const symFilter = symbol ? "AND f_symbol = :symbol" : "";
    return sequelize.query(
      `SELECT f_algo_no AS algoNo, f_symbol AS symbol, f_side AS side, f_algo_type AS algoType,
              f_trigger_price AS triggerPrice, f_order_price AS orderPrice, f_quantity AS quantity,
              f_callback_rate AS callbackRate, f_peak_price AS peakPrice, f_group_no AS groupNo,
              f_status AS status, UNIX_TIMESTAMP(f_create_time)*1000 AS createdAt
       FROM t_spot_algo_order WHERE f_user_id = :userId AND f_status = 'active'
       ${symFilter} ORDER BY f_id DESC`,
      { replacements: { userId, symbol }, type: QueryTypes.SELECT },
    );
  }

  static async listHistory(userId: number, page = 1, pageSize = 50) {
    const sequelize = await getSequelize();
    if (!sequelize) return { rows: [], total: 0 };
    const offset = (page - 1) * pageSize;
    const rows = await sequelize.query(
      `SELECT f_algo_no AS algoNo, f_symbol AS symbol, f_side AS side, f_algo_type AS algoType,
              f_trigger_price AS triggerPrice, f_order_price AS orderPrice, f_quantity AS quantity,
              f_status AS status, f_triggered_order_no AS triggeredOrderNo, f_group_no AS groupNo,
              UNIX_TIMESTAMP(f_create_time)*1000 AS createdAt
       FROM t_spot_algo_order WHERE f_user_id = :userId AND f_status != 'active'
       ORDER BY f_id DESC LIMIT :limit OFFSET :offset`,
      { replacements: { userId, limit: pageSize, offset }, type: QueryTypes.SELECT },
    );
    const total = await sequelize.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM t_spot_algo_order WHERE f_user_id = :userId AND f_status != 'active'`,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
    return { rows, total: total[0]?.cnt ?? 0, page, pageSize };
  }

  static async cancel(userId: number, algoNo: string) {
    const sequelize = await getSequelize();
    if (!sequelize) throw new BadRequestError("数据库未启用");

    const rows = await sequelize.query<{ status: string; groupNo: string }>(
      `SELECT f_status AS status, f_group_no AS groupNo FROM t_spot_algo_order
       WHERE f_user_id = :userId AND f_algo_no = :algoNo LIMIT 1`,
      { replacements: { userId, algoNo }, type: QueryTypes.SELECT },
    );
    if (!rows[0]) throw new BadRequestError("条件单不存在");
    if (rows[0].status !== "active") throw new BadRequestError("条件单不可撤销");

    await sequelize.query(
      `UPDATE t_spot_algo_order SET f_status = 'cancelled' WHERE f_algo_no = :algoNo`,
      { replacements: { algoNo } },
    );
    return { algoNo, status: "cancelled" as const };
  }

  private static async cancelGroupExcept(
    sequelize: NonNullable<Awaited<ReturnType<typeof getSequelize>>>,
    groupNo: string,
    exceptAlgoNo: string,
  ) {
    if (!groupNo) return;
    await sequelize.query(
      `UPDATE t_spot_algo_order SET f_status = 'cancelled'
       WHERE f_group_no = :groupNo AND f_algo_no != :exceptAlgoNo AND f_status = 'active'`,
      { replacements: { groupNo, exceptAlgoNo } },
    );
  }

  /** 轮询触发条件单（含移动止盈） */
  static async processTriggers(): Promise<number> {
    const sequelize = await getSequelize();
    if (!sequelize) return 0;

    const rows = await sequelize.query<{
      id: number;
      algoNo: string;
      userId: number;
      symbol: string;
      side: string;
      algoType: string;
      triggerPrice: string;
      orderPrice: string | null;
      quantity: string;
      callbackRate: string | null;
      peakPrice: string | null;
      groupNo: string;
    }>(
      `SELECT f_id AS id, f_algo_no AS algoNo, f_user_id AS userId, f_symbol AS symbol,
              f_side AS side, f_algo_type AS algoType, f_trigger_price AS triggerPrice,
              f_order_price AS orderPrice, f_quantity AS quantity,
              f_callback_rate AS callbackRate, f_peak_price AS peakPrice, f_group_no AS groupNo
       FROM t_spot_algo_order WHERE f_status = 'active' ORDER BY f_id ASC LIMIT 200`,
      { type: QueryTypes.SELECT },
    );

    let triggered = 0;
    for (const row of rows) {
      try {
        const last = await SpotSymbolService.getLastPrice(row.symbol);
        let hit = false;

        if (row.algoType === "trailing_stop") {
          const rate = Number(row.callbackRate ?? 0);
          let peak = Number(row.peakPrice ?? last);
          if (row.side === "sell") {
            if (last > peak) {
              peak = last;
              await sequelize.query(
                `UPDATE t_spot_algo_order SET f_peak_price = :peak WHERE f_algo_no = :algoNo`,
                { replacements: { peak, algoNo: row.algoNo } },
              );
            }
            hit = last <= peak * (1 - rate);
          } else {
            if (last < peak) {
              peak = last;
              await sequelize.query(
                `UPDATE t_spot_algo_order SET f_peak_price = :peak WHERE f_algo_no = :algoNo`,
                { replacements: { peak, algoNo: row.algoNo } },
              );
            }
            hit = last >= peak * (1 + rate);
          }
        } else {
          const trigger = Number(row.triggerPrice);
          hit =
            row.algoType === "stop_loss"
              ? row.side === "sell"
                ? last <= trigger
                : last >= trigger
              : row.side === "sell"
                ? last >= trigger
                : last <= trigger;
        }
        if (!hit) continue;

        const order = await SpotOrderService.placeOrder(row.userId, {
          symbol: row.symbol,
          side: row.side as "buy" | "sell",
          type: row.orderPrice ? "limit" : "market",
          price: row.orderPrice ? Number(row.orderPrice) : null,
          quantity: Number(row.quantity),
        });

        await sequelize.query(
          `UPDATE t_spot_algo_order SET f_status = 'triggered', f_triggered_order_no = :orderNo
           WHERE f_algo_no = :algoNo`,
          { replacements: { algoNo: row.algoNo, orderNo: order.orderNo } },
        );
        await this.cancelGroupExcept(sequelize, row.groupNo, row.algoNo);

        await NotificationService.create(row.userId, {
          type: "trade",
          title: "条件单已触发",
          body: `${row.symbol} ${row.algoType} 已触发并下单`,
          refId: order.orderNo,
        });
        triggered += 1;
      } catch (err) {
        console.error("[algo-order] trigger failed:", (err as Error).message);
      }
    }
    return triggered;
  }
}

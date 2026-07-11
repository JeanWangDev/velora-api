import type { Transaction } from "sequelize";
import { QueryTypes } from "sequelize";
import { getSequelize } from "@/db/connection";
import { AccountService, roundAmount } from "@/services/account/account.service";
import { SpotSymbolService } from "@/services/spot/spot-symbol.service";
import { FuturesSymbolService } from "@/services/futures/futures-symbol.service";
import { NotificationService } from "@/services/notification/notification.service";

const MAINT_MARGIN_RATE = 0.005;

export interface FuturesOrderRow {
  id: number;
  orderNo: string;
  userId: number;
  symbol: string;
  side: "buy" | "sell";
  posSide: "long" | "short";
  type: "limit" | "market";
  price: string | null;
  quantity: string;
  filledQuantity: string;
  leverage: number;
  marginMode: "cross" | "isolated";
  reduceOnly: number;
  status: string;
}

function spotSymbolOf(futuresSymbol: string): string {
  return FuturesSymbolService.spotIndexSymbol(futuresSymbol);
}

function calcLiquidationPrice(
  side: "long" | "short",
  entry: number,
  leverage: number,
): number {
  const imr = 1 / leverage;
  if (side === "long") {
    return roundAmount(entry * (1 - imr + MAINT_MARGIN_RATE));
  }
  return roundAmount(entry * (1 + imr - MAINT_MARGIN_RATE));
}

export class FuturesEngineService {
  /** 标记价格 = 现货指数价 */
  static async getMarkPrice(futuresSymbol: string): Promise<number> {
    const spot = spotSymbolOf(futuresSymbol);
    return SpotSymbolService.getLastPrice(spot);
  }

  static async updateMarkPrices(): Promise<void> {
    const sequelize = await getSequelize();
    if (!sequelize) return;

    const symbols = await FuturesSymbolService.list();
    for (const sym of symbols) {
      const mark = await this.getMarkPrice(sym.symbol);
      await sequelize.query(
        `UPDATE t_futures_symbol SET f_mark_price = :mark, f_index_price = :mark WHERE f_symbol = :symbol`,
        { replacements: { mark, symbol: sym.symbol } },
      );
    }
  }

  static async updateUnrealizedPnl(): Promise<void> {
    const sequelize = await getSequelize();
    if (!sequelize) return;

    const positions = await sequelize.query<{
      id: number;
      symbol: string;
      side: string;
      quantity: string;
      entryPrice: string;
      leverage: number;
    }>(
      `SELECT f_id AS id, f_symbol AS symbol, f_side AS side, f_quantity AS quantity,
              f_entry_price AS entryPrice, f_leverage AS leverage
       FROM t_futures_position WHERE f_status = 'open' AND f_quantity > 0`,
      { type: QueryTypes.SELECT },
    );

    for (const pos of positions) {
      const mark = await this.getMarkPrice(pos.symbol);
      const qty = Number(pos.quantity);
      const entry = Number(pos.entryPrice);
      const pnl =
        pos.side === "long"
          ? roundAmount((mark - entry) * qty)
          : roundAmount((entry - mark) * qty);
      const liq = calcLiquidationPrice(pos.side as "long" | "short", entry, pos.leverage);
      await sequelize.query(
        `UPDATE t_futures_position SET f_unrealized_pnl = :pnl, f_liquidation_price = :liq
         WHERE f_id = :id`,
        { replacements: { pnl, liq, id: pos.id } },
      );
    }
  }

  /** 限价单撮合：价格触达则成交 */
  static async matchOpenOrders(): Promise<number> {
    const sequelize = await getSequelize();
    if (!sequelize) return 0;

    const rows = await sequelize.query<FuturesOrderRow>(
      `SELECT f_id AS id, f_order_no AS orderNo, f_user_id AS userId, f_symbol AS symbol,
              f_side AS side, f_pos_side AS posSide, f_type AS type, f_price AS price,
              f_quantity AS quantity, f_filled_quantity AS filledQuantity,
              f_leverage AS leverage, f_margin_mode AS marginMode, f_reduce_only AS reduceOnly,
              f_status AS status
       FROM t_futures_order WHERE f_status = 'open' ORDER BY f_id ASC LIMIT 200`,
      { type: QueryTypes.SELECT },
    );

    let filled = 0;
    for (const row of rows) {
      const mark = await this.getMarkPrice(row.symbol);
      const limit = Number(row.price);
      const canFill =
        row.type === "market" ||
        (row.side === "buy" && mark <= limit) ||
        (row.side === "sell" && mark >= limit);
      if (!canFill) continue;

      const execPrice = row.type === "market" ? mark : limit;
      const remain = roundAmount(Number(row.quantity) - Number(row.filledQuantity));
      if (!(remain > 0)) continue;

      try {
        await AccountService.runInTransaction(async (tx) => {
          await this.fillOrder(row, execPrice, remain, tx);
        });
        filled += 1;
      } catch (err) {
        console.error("[futures-engine] fill failed:", (err as Error).message);
      }
    }
    return filled;
  }

  static async fillOrder(
    order: FuturesOrderRow,
    execPrice: number,
    fillQty: number,
    tx: Transaction,
  ): Promise<void> {
    const sequelize = await getSequelize();
    if (!sequelize) return;

    const margin = roundAmount((execPrice * fillQty) / order.leverage);
    const reduceOnly = order.reduceOnly === 1;

    if (reduceOnly) {
      await this.reducePosition(order, execPrice, fillQty, tx);
    } else {
      await this.openPosition(order, execPrice, fillQty, margin, tx);
    }

    const newFilled = roundAmount(Number(order.filledQuantity) + fillQty);
    const status = newFilled >= Number(order.quantity) ? "filled" : "partial";

    await sequelize.query(
      `UPDATE t_futures_order SET f_filled_quantity = :filled, f_status = :status, f_price = :price
       WHERE f_order_no = :orderNo`,
      {
        replacements: {
          filled: newFilled,
          status,
          price: execPrice,
          orderNo: order.orderNo,
        },
        transaction: tx,
      },
    );

    if (!reduceOnly && status === "filled") {
      const frozen = roundAmount(
        (Number(order.price ?? execPrice) * Number(order.quantity)) / order.leverage,
      );
      const used = roundAmount((execPrice * Number(order.quantity)) / order.leverage);
      const refund = roundAmount(Math.max(0, frozen - used));
      if (refund > 0) {
        await AccountService.adjust(
          {
            userId: order.userId,
            currency: "USDT",
            accountType: "futures",
            availableDelta: refund,
            frozenDelta: -refund,
            ledgerType: "unfreeze",
            ledgerAmount: refund,
            refId: order.orderNo,
          },
          tx,
        );
      }
      await AccountService.adjust(
        {
          userId: order.userId,
          currency: "USDT",
          accountType: "futures",
          frozenDelta: -used,
          ledgerType: "trade",
          ledgerAmount: -used,
          refId: order.orderNo,
        },
        tx,
      );
    }

    await NotificationService.create(order.userId, {
      type: "trade",
      title: "合约订单成交",
      body: `${order.symbol} ${order.posSide} ${fillQty} @ ${execPrice}`,
      refId: order.orderNo,
    });
  }

  private static async openPosition(
    order: FuturesOrderRow,
    price: number,
    qty: number,
    margin: number,
    tx: Transaction,
  ) {
    const sequelize = await getSequelize();
    const existing = await sequelize!.query<{
      quantity: string;
      entryPrice: string;
      margin: string;
    }>(
      `SELECT f_quantity AS quantity, f_entry_price AS entryPrice, f_margin AS margin
       FROM t_futures_position
       WHERE f_user_id = :userId AND f_symbol = :symbol AND f_side = :side
         AND f_margin_mode = :mode AND f_status = 'open' LIMIT 1`,
      {
        replacements: {
          userId: order.userId,
          symbol: order.symbol,
          side: order.posSide,
          mode: order.marginMode,
        },
        type: QueryTypes.SELECT,
        transaction: tx,
      },
    );

    const prev = existing[0];
    const prevQty = Number(prev?.quantity ?? 0);
    const prevEntry = Number(prev?.entryPrice ?? 0);
    const newQty = roundAmount(prevQty + qty);
    const newEntry =
      prevQty > 0
        ? roundAmount((prevEntry * prevQty + price * qty) / newQty)
        : price;
    const newMargin = roundAmount(Number(prev?.margin ?? 0) + margin);
    const liq = calcLiquidationPrice(order.posSide, newEntry, order.leverage);

    await sequelize!.query(
      `INSERT INTO t_futures_position
        (f_user_id, f_symbol, f_side, f_margin_mode, f_leverage, f_quantity, f_entry_price, f_margin, f_liquidation_price)
       VALUES (:userId, :symbol, :side, :mode, :lev, :qty, :entry, :margin, :liq)
       ON DUPLICATE KEY UPDATE
         f_quantity = :qty, f_entry_price = :entry, f_margin = :margin,
         f_liquidation_price = :liq, f_status = 'open', f_leverage = :lev`,
      {
        replacements: {
          userId: order.userId,
          symbol: order.symbol,
          side: order.posSide,
          mode: order.marginMode,
          lev: order.leverage,
          qty: newQty,
          entry: newEntry,
          margin: newMargin,
          liq,
        },
        transaction: tx,
      },
    );
  }

  private static async reducePosition(
    order: FuturesOrderRow,
    price: number,
    qty: number,
    tx: Transaction,
  ) {
    const sequelize = await getSequelize();
    const rows = await sequelize!.query<{
      quantity: string;
      entryPrice: string;
      margin: string;
    }>(
      `SELECT f_quantity AS quantity, f_entry_price AS entryPrice, f_margin AS margin
       FROM t_futures_position
       WHERE f_user_id = :userId AND f_symbol = :symbol AND f_side = :side
         AND f_margin_mode = :mode AND f_status = 'open' LIMIT 1`,
      {
        replacements: {
          userId: order.userId,
          symbol: order.symbol,
          side: order.posSide,
          mode: order.marginMode,
        },
        type: QueryTypes.SELECT,
        transaction: tx,
      },
    );
    const pos = rows[0];
    if (!pos || Number(pos.quantity) < qty) {
      throw new Error("持仓不足，无法平仓");
    }

    const entry = Number(pos.entryPrice);
    const realized =
      order.posSide === "long"
        ? roundAmount((price - entry) * qty)
        : roundAmount((entry - price) * qty);

    const remainQty = roundAmount(Number(pos.quantity) - qty);
    const marginReleased = roundAmount(
      (Number(pos.margin) * qty) / Number(pos.quantity),
    );

    if (remainQty <= 0) {
      await sequelize!.query(
        `UPDATE t_futures_position SET f_quantity = 0, f_margin = 0, f_unrealized_pnl = 0,
         f_status = 'closed' WHERE f_user_id = :userId AND f_symbol = :symbol AND f_side = :side
         AND f_margin_mode = :mode`,
        {
          replacements: {
            userId: order.userId,
            symbol: order.symbol,
            side: order.posSide,
            mode: order.marginMode,
          },
          transaction: tx,
        },
      );
    } else {
      const liq = calcLiquidationPrice(order.posSide, entry, order.leverage);
      await sequelize!.query(
        `UPDATE t_futures_position SET f_quantity = :qty, f_margin = f_margin - :released,
         f_liquidation_price = :liq WHERE f_user_id = :userId AND f_symbol = :symbol
         AND f_side = :side AND f_margin_mode = :mode`,
        {
          replacements: {
            qty: remainQty,
            released: marginReleased,
            liq,
            userId: order.userId,
            symbol: order.symbol,
            side: order.posSide,
            mode: order.marginMode,
          },
          transaction: tx,
        },
      );
    }

    const payout = roundAmount(marginReleased + realized);
    if (payout !== 0) {
      await AccountService.adjust(
        {
          userId: order.userId,
          currency: "USDT",
          accountType: "futures",
          availableDelta: payout,
          ledgerType: "trade",
          ledgerAmount: payout,
          refId: order.orderNo,
        },
        tx,
      );
    }
  }

  /** 强平：未实现亏损触及维持保证金 */
  static async checkLiquidations(): Promise<number> {
    const sequelize = await getSequelize();
    if (!sequelize) return 0;

    const positions = await sequelize.query<{
      id: number;
      userId: number;
      symbol: string;
      side: string;
      marginMode: string;
      leverage: number;
      quantity: string;
      entryPrice: string;
      margin: string;
      liquidationPrice: string;
    }>(
      `SELECT f_id AS id, f_user_id AS userId, f_symbol AS symbol, f_side AS side,
              f_margin_mode AS marginMode, f_leverage AS leverage, f_quantity AS quantity,
              f_entry_price AS entryPrice, f_margin AS margin, f_liquidation_price AS liquidationPrice
       FROM t_futures_position WHERE f_status = 'open' AND f_quantity > 0`,
      { type: QueryTypes.SELECT },
    );

    let liquidated = 0;
    for (const pos of positions) {
      const mark = await this.getMarkPrice(pos.symbol);
      const liq = Number(pos.liquidationPrice);
      const hit =
        pos.side === "long" ? mark <= liq : mark >= liq;
      if (!hit) continue;

      try {
        await AccountService.runInTransaction(async (tx) => {
          const fakeOrder: FuturesOrderRow = {
            id: 0,
            orderNo: `LIQ${Date.now()}`,
            userId: pos.userId,
            symbol: pos.symbol,
            side: pos.side === "long" ? "sell" : "buy",
            posSide: pos.side as "long" | "short",
            type: "market",
            price: String(mark),
            quantity: pos.quantity,
            filledQuantity: "0",
            leverage: pos.leverage,
            marginMode: pos.marginMode as "cross" | "isolated",
            reduceOnly: 1,
            status: "open",
          };
          await this.reducePosition(fakeOrder, mark, Number(pos.quantity), tx);
        });
        await NotificationService.create(pos.userId, {
          type: "risk",
          title: "持仓已强平",
          body: `${pos.symbol} ${pos.side} 已触发强平 @ ${mark}`,
          refId: String(pos.id),
        });
        liquidated += 1;
      } catch (err) {
        console.error("[futures-engine] liquidation failed:", (err as Error).message);
      }
    }
    return liquidated;
  }

  /** 资金费率结算（每 8 小时） */
  static async processFunding(): Promise<number> {
    const sequelize = await getSequelize();
    if (!sequelize) return 0;

    const symbols = await sequelize.query<{
      symbol: string;
      fundingRate: string;
      lastFundingAt: string | null;
      intervalHours: number;
    }>(
      `SELECT f_symbol AS symbol, f_funding_rate AS fundingRate,
              f_last_funding_at AS lastFundingAt, f_funding_interval_hours AS intervalHours
       FROM t_futures_symbol WHERE f_status = 1`,
      { type: QueryTypes.SELECT },
    );

    let settled = 0;
    const now = Date.now();
    for (const sym of symbols) {
      const last = sym.lastFundingAt ? new Date(sym.lastFundingAt).getTime() : 0;
      const intervalMs = sym.intervalHours * 3600_000;
      if (now - last < intervalMs) continue;

      const rate = Number(sym.fundingRate);
      const mark = await this.getMarkPrice(sym.symbol);

      const positions = await sequelize.query<{
        userId: number;
        side: string;
        quantity: string;
      }>(
        `SELECT f_user_id AS userId, f_side AS side, f_quantity AS quantity
         FROM t_futures_position WHERE f_symbol = :symbol AND f_status = 'open' AND f_quantity > 0`,
        { replacements: { symbol: sym.symbol }, type: QueryTypes.SELECT },
      );

      for (const pos of positions) {
        const notional = roundAmount(Number(pos.quantity) * mark);
        const payment = roundAmount(notional * rate);
        if (payment === 0) continue;

        const isLong = pos.side === "long";
        const delta = isLong ? -payment : payment;

        await AccountService.runInTransaction(async (tx) => {
          await AccountService.adjust(
            {
              userId: pos.userId,
              currency: "USDT",
              accountType: "futures",
              availableDelta: delta,
              ledgerType: "fee",
              ledgerAmount: delta,
              refId: `FUND-${sym.symbol}`,
            },
            tx,
          );
        });
      }

      await sequelize.query(
        `UPDATE t_futures_symbol SET f_last_funding_at = NOW() WHERE f_symbol = :symbol`,
        { replacements: { symbol: sym.symbol } },
      );
      settled += 1;
    }
    return settled;
  }
}

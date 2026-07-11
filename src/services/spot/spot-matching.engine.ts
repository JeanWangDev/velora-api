import type { Transaction } from "sequelize";
import { Op } from "sequelize";
import {
  SpotOrder,
  SpotSymbol,
  SpotTrade,
  type SpotOrderSide,
} from "@/db";
import { AccountService, roundAmount } from "@/services/account";
import { SYSTEM_LP_USER_ID } from "@/constants/exchange";
import { SpotSymbolService } from "@/services/spot/spot-symbol.service";

const EPSILON = 1e-9;

function genNo(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)
    .toString(36)
    .padStart(4, "0")}`.toUpperCase();
}

function remainingQty(order: SpotOrder): number {
  return roundAmount(Number(order.quantity) - Number(order.filledQuantity));
}

function updateOrderAfterFill(
  order: SpotOrder,
  fillQty: number,
  execPrice: number,
  fee: number,
  feeCurrency: string,
  quoteDelta: number,
) {
  const prevFilled = Number(order.filledQuantity);
  const newFilled = roundAmount(prevFilled + fillQty);
  const prevQuote = Number(order.quoteSpent);
  order.filledQuantity = String(newFilled);
  order.avgPrice = String(execPrice);
  order.quoteSpent = String(roundAmount(prevQuote + quoteDelta));
  order.fee = String(roundAmount(Number(order.fee) + fee));
  order.feeCurrency = feeCurrency;
  order.status =
    newFilled >= Number(order.quantity) - EPSILON ? "filled" : "partial";
  if (order.status === "filled") {
    order.frozenCurrency = "";
    order.frozenAmount = "0";
  }
}

/**
 * CLOB 撮合引擎：用户订单互相撮合，市价单剩余部分由系统 LP 按外部行情成交。
 */
export class SpotMatchingEngine {
  /** 下单后立即尝试撮合 */
  static async matchOrder(
    order: SpotOrder,
    meta: SpotSymbol,
    tx: Transaction,
  ): Promise<void> {
    let remaining = remainingQty(order);
    if (remaining <= EPSILON) return;

    const oppositeSide: SpotOrderSide = order.side === "buy" ? "sell" : "buy";
    const priceOp = order.side === "buy" ? Op.lte : Op.gte;
    const priceOrder: [string, string][] =
      order.side === "buy"
        ? [["price", "ASC"], ["id", "ASC"]]
        : [["price", "DESC"], ["id", "ASC"]];

    const limitPrice =
      order.type === "limit" && order.price !== null
        ? Number(order.price)
        : null;

    while (remaining > EPSILON) {
      const where: Record<string, unknown> = {
        symbol: order.symbol,
        side: oppositeSide,
        status: { [Op.in]: ["open", "partial"] },
        type: "limit",
        userId: { [Op.ne]: order.userId },
      };
      if (limitPrice !== null) {
        where.price = { [priceOp]: limitPrice };
      }

      const maker = await SpotOrder.findOne({
        where,
        order: priceOrder,
        transaction: tx,
        lock: tx.LOCK.UPDATE,
      });
      if (!maker || !maker.price) break;

      const makerRemaining = remainingQty(maker);
      if (makerRemaining <= EPSILON) continue;

      const fillQty = roundAmount(Math.min(remaining, makerRemaining));
      const execPrice = Number(maker.price);

      await this.settlePair(
        order,
        maker,
        fillQty,
        execPrice,
        meta,
        tx,
        order.id < maker.id ? "taker" : "maker",
      );

      await order.reload({ transaction: tx });
      remaining = remainingQty(order);
    }

    if (remaining > EPSILON && order.type === "market") {
      const lastPrice = await SpotSymbolService.getLastPrice(order.symbol);
      await this.settleLp(order, remaining, lastPrice, meta, tx);
    }
  }

  /** 轮询：尝试撮合所有挂单（用户间 + 可成交限价单 LP 兜底） */
  static async matchOpenOrders(): Promise<number> {
    const orders = await SpotOrder.findAll({
      where: { status: { [Op.in]: ["open", "partial"] } },
      order: [["id", "ASC"]],
    });
    let filled = 0;

    for (const order of orders) {
      if (remainingQty(order) <= EPSILON) continue;
      try {
        const meta = await SpotSymbolService.requireTrading(order.symbol);
        await AccountService.runInTransaction(async (tx) => {
          const locked = await SpotOrder.findOne({
            where: { id: order.id },
            transaction: tx,
            lock: tx.LOCK.UPDATE,
          });
          if (!locked || (locked.status !== "open" && locked.status !== "partial")) {
            return;
          }
          const before = remainingQty(locked);
          await this.matchOrder(locked, meta, tx);

          if (
            locked.type === "limit" &&
            remainingQty(locked) > EPSILON &&
            locked.price
          ) {
            const lastPrice = await SpotSymbolService.getLastPrice(locked.symbol);
            const price = Number(locked.price);
            const cross =
              locked.side === "buy" ? lastPrice <= price : lastPrice >= price;
            if (cross) {
              await this.settleLp(locked, remainingQty(locked), price, meta, tx);
            }
          }

          await locked.reload({ transaction: tx });
          if (remainingQty(locked) < before - EPSILON) filled += 1;
        });
      } catch (err) {
        console.error("[clob] match failed:", (err as Error).message);
      }
    }
    return filled;
  }

  private static async settlePair(
    taker: SpotOrder,
    maker: SpotOrder,
    qty: number,
    execPrice: number,
    meta: SpotSymbol,
    tx: Transaction,
    takerRole: "taker" | "maker",
  ) {
    const makerRole = takerRole === "taker" ? "maker" : "taker";
    const takerFill = await this.applyFill(taker, qty, execPrice, meta, tx, takerRole, true);
    const makerFill = await this.applyFill(maker, qty, execPrice, meta, tx, makerRole, true);

    await SpotTrade.create(
      {
        tradeNo: genNo("ST"),
        orderId: taker.id,
        orderNo: taker.orderNo,
        userId: taker.userId,
        counterUserId: maker.userId,
        symbol: taker.symbol,
        side: taker.side,
        price: execPrice,
        quantity: qty,
        fee: takerFill.fee,
        feeCurrency: takerFill.feeCurrency,
        role: takerRole,
      },
      { transaction: tx },
    );
    await SpotTrade.create(
      {
        tradeNo: genNo("ST"),
        orderId: maker.id,
        orderNo: maker.orderNo,
        userId: maker.userId,
        counterUserId: taker.userId,
        symbol: maker.symbol,
        side: maker.side,
        price: execPrice,
        quantity: qty,
        fee: makerFill.fee,
        feeCurrency: makerFill.feeCurrency,
        role: makerRole,
      },
      { transaction: tx },
    );

    await taker.save({ transaction: tx });
    await maker.save({ transaction: tx });
  }

  private static async settleLp(
    order: SpotOrder,
    qty: number,
    execPrice: number,
    meta: SpotSymbol,
    tx: Transaction,
  ) {
    const fill = await this.applyFill(order, qty, execPrice, meta, tx, "taker", false);
    await this.applyLpCounterparty(order, qty, execPrice, meta, tx);

    await SpotTrade.create(
      {
        tradeNo: genNo("ST"),
        orderId: order.id,
        orderNo: order.orderNo,
        userId: order.userId,
        counterUserId: SYSTEM_LP_USER_ID,
        symbol: order.symbol,
        side: order.side,
        price: execPrice,
        quantity: qty,
        fee: fill.fee,
        feeCurrency: fill.feeCurrency,
        role: "taker",
      },
      { transaction: tx },
    );
    await order.save({ transaction: tx });
  }

  /** LP 对手方库存变动（系统流动性账户） */
  private static async applyLpCounterparty(
    order: SpotOrder,
    qty: number,
    execPrice: number,
    meta: SpotSymbol,
    tx: Transaction,
  ) {
    const lpUserId = SYSTEM_LP_USER_ID;
    if (order.side === "buy") {
      const quoteGross = roundAmount(execPrice * qty);
      await AccountService.adjust(
        {
          userId: lpUserId,
          currency: meta.base,
          accountType: "trading",
          availableDelta: -qty,
          ledgerType: "trade",
          ledgerAmount: -qty,
          refId: order.orderNo,
        },
        tx,
      );
      await AccountService.adjust(
        {
          userId: lpUserId,
          currency: meta.quote,
          accountType: "trading",
          availableDelta: quoteGross,
          ledgerType: "trade",
          ledgerAmount: quoteGross,
          refId: order.orderNo,
        },
        tx,
      );
    } else {
      const quoteGross = roundAmount(execPrice * qty);
      await AccountService.adjust(
        {
          userId: lpUserId,
          currency: meta.base,
          accountType: "trading",
          availableDelta: qty,
          ledgerType: "trade",
          ledgerAmount: qty,
          refId: order.orderNo,
        },
        tx,
      );
      await AccountService.adjust(
        {
          userId: lpUserId,
          currency: meta.quote,
          accountType: "trading",
          availableDelta: -quoteGross,
          ledgerType: "trade",
          ledgerAmount: -quoteGross,
          refId: order.orderNo,
        },
        tx,
      );
    }
  }

  private static async applyFill(
    order: SpotOrder,
    qty: number,
    execPrice: number,
    meta: SpotSymbol,
    tx: Transaction,
    role: "maker" | "taker",
    fromFrozen: boolean,
  ): Promise<{ fee: number; feeCurrency: string }> {
    const feeRate = role === "maker" ? Number(meta.makerFee) : Number(meta.takerFee);
    let fee: number;
    let feeCurrency: string;
    let quoteDelta: number;

    if (order.side === "buy") {
      const quoteCost = roundAmount(execPrice * qty);
      fee = roundAmount(qty * feeRate);
      feeCurrency = meta.base;
      quoteDelta = quoteCost;
      const baseGained = roundAmount(qty - fee);

      await AccountService.adjust(
        {
          userId: order.userId,
          currency: meta.quote,
          availableDelta: fromFrozen ? 0 : -quoteCost,
          frozenDelta: fromFrozen ? -quoteCost : 0,
          ledgerType: "trade",
          ledgerAmount: -quoteCost,
          refId: order.orderNo,
        },
        tx,
      );
      await AccountService.adjust(
        {
          userId: order.userId,
          currency: meta.base,
          availableDelta: baseGained,
          ledgerType: "trade",
          ledgerAmount: baseGained,
          refId: order.orderNo,
        },
        tx,
      );
    } else {
      const quoteGross = roundAmount(execPrice * qty);
      fee = roundAmount(quoteGross * feeRate);
      feeCurrency = meta.quote;
      quoteDelta = roundAmount(quoteGross - fee);

      await AccountService.adjust(
        {
          userId: order.userId,
          currency: meta.base,
          availableDelta: fromFrozen ? 0 : -qty,
          frozenDelta: fromFrozen ? -qty : 0,
          ledgerType: "trade",
          ledgerAmount: -qty,
          refId: order.orderNo,
        },
        tx,
      );
      await AccountService.adjust(
        {
          userId: order.userId,
          currency: meta.quote,
          availableDelta: quoteDelta,
          ledgerType: "trade",
          ledgerAmount: quoteDelta,
          refId: order.orderNo,
        },
        tx,
      );
    }

    if (fee > EPSILON) {
      await AccountService.adjust(
        {
          userId: order.userId,
          currency: feeCurrency,
          availableDelta: -fee,
          ledgerType: "fee",
          ledgerAmount: -fee,
          refId: order.orderNo,
        },
        tx,
      );
    }

    updateOrderAfterFill(order, qty, execPrice, fee, feeCurrency, quoteDelta);

    if (order.status !== "filled" && fromFrozen && Number(order.frozenAmount) > EPSILON) {
      const totalQty = Number(order.quantity);
      const filled = Number(order.filledQuantity);
      const frozenTotal = Number(order.frozenAmount);
      const unfreezeRatio = roundAmount(filled / totalQty);
      const toRelease = roundAmount(frozenTotal * unfreezeRatio);
      if (toRelease > EPSILON && order.frozenCurrency) {
        order.frozenAmount = String(roundAmount(frozenTotal - toRelease));
      }
    }

    return { fee, feeCurrency };
  }
}

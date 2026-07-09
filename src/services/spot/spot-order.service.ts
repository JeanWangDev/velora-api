import type { Transaction } from "sequelize";
import { Op } from "sequelize";
import { config } from "@/config";
import {
  SpotOrder,
  SpotSymbol,
  SpotTrade,
  type SpotOrderSide,
  type SpotOrderType,
} from "@/db";
import { BadRequestError, NotFoundError } from "@/errors/app-error";
import { AccountService, roundAmount } from "@/services/account";
import { SpotSymbolService } from "@/services/spot/spot-symbol.service";

const EPSILON = 1e-9;

export interface PlaceOrderInput {
  symbol: string;
  side: SpotOrderSide;
  type: SpotOrderType;
  price: number | null;
  quantity: number;
}

function assertDbReady() {
  if (!config.db.enabled) {
    throw new BadRequestError("数据库未启用");
  }
}

function genNo(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)
    .toString(36)
    .padStart(4, "0")}`.toUpperCase();
}

interface FillParams {
  execPrice: number;
  qty: number;
  role: "maker" | "taker";
  /** true=从冻结结算（挂单撮合）；false=从可用结算（即时成交） */
  fromFrozen: boolean;
}

export class SpotOrderService {
  /** 下单：市价即时成交 / 限价即时成交 / 限价挂单 */
  static async placeOrder(userId: number, input: PlaceOrderInput): Promise<SpotOrder> {
    assertDbReady();

    const meta = await SpotSymbolService.requireTrading(input.symbol);
    const quantity = roundAmount(input.quantity);

    if (!(quantity > 0)) {
      throw new BadRequestError("下单数量必须大于 0");
    }
    if (quantity < Number(meta.minQty) - EPSILON) {
      throw new BadRequestError(`低于最小下单量 ${Number(meta.minQty)} ${meta.base}`);
    }
    if (input.type === "limit" && !(Number(input.price) > 0)) {
      throw new BadRequestError("请填写有效的限价价格");
    }

    const lastPrice = await SpotSymbolService.getLastPrice(input.symbol);
    const limitPrice = input.type === "limit" ? roundAmount(Number(input.price)) : null;

    // 是否可即时成交
    let immediate = input.type === "market";
    if (input.type === "limit" && limitPrice !== null) {
      immediate =
        input.side === "buy" ? limitPrice >= lastPrice : limitPrice <= lastPrice;
    }
    const execPrice = immediate ? lastPrice : (limitPrice as number);

    const order = await AccountService.runInTransaction(async (tx) => {
      const created = await SpotOrder.create(
        {
          orderNo: genNo("SO"),
          userId,
          symbol: meta.symbol,
          side: input.side,
          type: input.type,
          price: limitPrice,
          quantity,
          filledQuantity: 0,
          avgPrice: 0,
          quoteSpent: 0,
          fee: 0,
          feeCurrency: "",
          frozenCurrency: "",
          frozenAmount: 0,
          status: "open",
        },
        { transaction: tx },
      );

      if (immediate) {
        await this.assertImmediateBalance(userId, input.side, execPrice, quantity, meta, tx);
        await this.settleFill(
          created,
          { execPrice, qty: quantity, role: "taker", fromFrozen: false },
          meta,
          tx,
        );
      } else {
        await this.freezeForLimit(created, limitPrice as number, quantity, meta, tx);
      }

      return created;
    });

    await order.reload();
    return order;
  }

  /** 校验即时成交所需可用余额 */
  private static async assertImmediateBalance(
    userId: number,
    side: SpotOrderSide,
    execPrice: number,
    qty: number,
    meta: SpotSymbol,
    tx: Transaction,
  ) {
    if (side === "buy") {
      const need = roundAmount(execPrice * qty);
      const avail = await AccountService.getAvailable(userId, meta.quote, tx);
      if (avail < need - EPSILON) {
        throw new BadRequestError(`${meta.quote} 余额不足`);
      }
    } else {
      const avail = await AccountService.getAvailable(userId, meta.base, tx);
      if (avail < qty - EPSILON) {
        throw new BadRequestError(`${meta.base} 余额不足`);
      }
    }
  }

  /** 限价挂单：冻结对应资金 */
  private static async freezeForLimit(
    order: SpotOrder,
    price: number,
    qty: number,
    meta: SpotSymbol,
    tx: Transaction,
  ) {
    if (order.side === "buy") {
      const freeze = roundAmount(price * qty);
      const avail = await AccountService.getAvailable(order.userId, meta.quote, tx);
      if (avail < freeze - EPSILON) {
        throw new BadRequestError(`${meta.quote} 余额不足`);
      }
      await AccountService.adjust(
        {
          userId: order.userId,
          currency: meta.quote,
          availableDelta: -freeze,
          frozenDelta: freeze,
          ledgerType: "freeze",
          ledgerAmount: -freeze,
          refId: order.orderNo,
        },
        tx,
      );
      order.frozenCurrency = meta.quote;
      order.frozenAmount = String(freeze);
    } else {
      const avail = await AccountService.getAvailable(order.userId, meta.base, tx);
      if (avail < qty - EPSILON) {
        throw new BadRequestError(`${meta.base} 余额不足`);
      }
      await AccountService.adjust(
        {
          userId: order.userId,
          currency: meta.base,
          availableDelta: -qty,
          frozenDelta: qty,
          ledgerType: "freeze",
          ledgerAmount: -qty,
          refId: order.orderNo,
        },
        tx,
      );
      order.frozenCurrency = meta.base;
      order.frozenAmount = String(qty);
    }
    await order.save({ transaction: tx });
  }

  /** 结算一笔成交：更新余额、写成交、更新订单（模拟盘一次全成） */
  private static async settleFill(
    order: SpotOrder,
    fill: FillParams,
    meta: SpotSymbol,
    tx: Transaction,
  ) {
    const feeRate = fill.role === "maker" ? Number(meta.makerFee) : Number(meta.takerFee);
    const { execPrice, qty } = fill;

    let fee: number;
    let feeCurrency: string;
    let quoteSpent: number;

    if (order.side === "buy") {
      const quoteCost = roundAmount(execPrice * qty);
      fee = roundAmount(qty * feeRate);
      feeCurrency = meta.base;
      const baseGained = roundAmount(qty - fee);
      quoteSpent = quoteCost;

      // 扣计价币（挂单从冻结，即时从可用）
      await AccountService.adjust(
        {
          userId: order.userId,
          currency: meta.quote,
          availableDelta: fill.fromFrozen ? 0 : -quoteCost,
          frozenDelta: fill.fromFrozen ? -quoteCost : 0,
          ledgerType: "trade",
          ledgerAmount: -quoteCost,
          refId: order.orderNo,
        },
        tx,
      );
      // 到账基础币（已扣手续费）
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
      const quoteGained = roundAmount(quoteGross - fee);
      quoteSpent = quoteGained;

      // 扣基础币（挂单从冻结，即时从可用）
      await AccountService.adjust(
        {
          userId: order.userId,
          currency: meta.base,
          availableDelta: fill.fromFrozen ? 0 : -qty,
          frozenDelta: fill.fromFrozen ? -qty : 0,
          ledgerType: "trade",
          ledgerAmount: -qty,
          refId: order.orderNo,
        },
        tx,
      );
      // 到账计价币（已扣手续费）
      await AccountService.adjust(
        {
          userId: order.userId,
          currency: meta.quote,
          availableDelta: quoteGained,
          ledgerType: "trade",
          ledgerAmount: quoteGained,
          refId: order.orderNo,
        },
        tx,
      );
    }

    await SpotTrade.create(
      {
        tradeNo: genNo("ST"),
        orderId: order.id,
        orderNo: order.orderNo,
        userId: order.userId,
        symbol: order.symbol,
        side: order.side,
        price: execPrice,
        quantity: qty,
        fee,
        feeCurrency,
        role: fill.role,
      },
      { transaction: tx },
    );

    order.filledQuantity = String(roundAmount(Number(order.filledQuantity) + qty));
    order.avgPrice = String(execPrice);
    order.quoteSpent = String(roundAmount(Number(order.quoteSpent) + quoteSpent));
    order.fee = String(roundAmount(Number(order.fee) + fee));
    order.feeCurrency = feeCurrency;
    order.frozenCurrency = "";
    order.frozenAmount = "0";
    order.status = "filled";
    await order.save({ transaction: tx });
  }

  /** 撤单：释放剩余冻结 */
  static async cancelOrder(userId: number, orderNo: string): Promise<SpotOrder> {
    assertDbReady();

    return AccountService.runInTransaction(async (tx) => {
      const order = await SpotOrder.findOne({
        where: { orderNo, userId },
        transaction: tx,
        lock: tx.LOCK.UPDATE,
      });
      if (!order) {
        throw new NotFoundError("订单不存在");
      }
      if (order.status !== "open" && order.status !== "partial") {
        throw new BadRequestError("该订单无法撤销");
      }

      const frozen = Number(order.frozenAmount);
      if (frozen > EPSILON && order.frozenCurrency) {
        await AccountService.adjust(
          {
            userId,
            currency: order.frozenCurrency,
            availableDelta: frozen,
            frozenDelta: -frozen,
            ledgerType: "unfreeze",
            ledgerAmount: frozen,
            refId: order.orderNo,
          },
          tx,
        );
      }

      order.frozenCurrency = "";
      order.frozenAmount = "0";
      order.status = "cancelled";
      await order.save({ transaction: tx });
      return order;
    });
  }

  /** 当前委托（未成交/部分成交） */
  static async listOpen(userId: number, symbol?: string): Promise<SpotOrder[]> {
    assertDbReady();
    const where: Record<string, unknown> = {
      userId,
      status: { [Op.in]: ["open", "partial"] },
    };
    if (symbol) where.symbol = symbol.toUpperCase();
    return SpotOrder.findAll({ where, order: [["id", "DESC"]] });
  }

  /** 历史委托（已成交/已撤销） */
  static async listHistory(
    userId: number,
    options?: { symbol?: string; page?: number; pageSize?: number },
  ): Promise<{ rows: SpotOrder[]; total: number; page: number; pageSize: number }> {
    assertDbReady();
    const page = Math.max(1, options?.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, options?.pageSize ?? 50));
    const where: Record<string, unknown> = {
      userId,
      status: { [Op.in]: ["filled", "cancelled"] },
    };
    if (options?.symbol) where.symbol = options.symbol.toUpperCase();

    const { rows, count } = await SpotOrder.findAndCountAll({
      where,
      order: [["id", "DESC"]],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return { rows, total: count, page, pageSize };
  }

  /** 成交记录 */
  static async listTrades(
    userId: number,
    options?: { symbol?: string; page?: number; pageSize?: number },
  ): Promise<{ rows: SpotTrade[]; total: number; page: number; pageSize: number }> {
    assertDbReady();
    const page = Math.max(1, options?.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, options?.pageSize ?? 50));
    const where: Record<string, unknown> = { userId };
    if (options?.symbol) where.symbol = options.symbol.toUpperCase();

    const { rows, count } = await SpotTrade.findAndCountAll({
      where,
      order: [["id", "DESC"]],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return { rows, total: count, page, pageSize };
  }

  /**
   * 撮合轮询：对所有限价挂单，若实时价触达委托价则以委托价成交。
   * 模拟盘一次性全额成交（maker 费率）。
   */
  static async matchOpenOrders(): Promise<number> {
    if (!config.db.enabled) return 0;

    const orders = await SpotOrder.findAll({
      where: { status: { [Op.in]: ["open", "partial"] }, type: "limit" },
      order: [["id", "ASC"]],
    });
    if (orders.length === 0) return 0;

    const priceCache = new Map<string, number>();
    const metaCache = new Map<string, SpotSymbol>();
    let filled = 0;

    for (const order of orders) {
      const symbol = order.symbol;
      const price = Number(order.price);
      if (!(price > 0)) continue;

      let lastPrice = priceCache.get(symbol);
      if (lastPrice === undefined) {
        try {
          lastPrice = await SpotSymbolService.getLastPrice(symbol);
          priceCache.set(symbol, lastPrice);
        } catch {
          continue;
        }
      }

      const hit = order.side === "buy" ? lastPrice <= price : lastPrice >= price;
      if (!hit) continue;

      let meta = metaCache.get(symbol);
      if (!meta) {
        try {
          meta = await SpotSymbolService.requireTrading(symbol);
          metaCache.set(symbol, meta);
        } catch {
          continue;
        }
      }

      try {
        await AccountService.runInTransaction(async (tx) => {
          const locked = await SpotOrder.findOne({
            where: { id: order.id },
            transaction: tx,
            lock: tx.LOCK.UPDATE,
          });
          if (!locked || (locked.status !== "open" && locked.status !== "partial")) {
            return;
          }
          const remaining = roundAmount(
            Number(locked.quantity) - Number(locked.filledQuantity),
          );
          if (remaining <= EPSILON) return;
          await this.settleFill(
            locked,
            { execPrice: price, qty: remaining, role: "maker", fromFrozen: true },
            meta as SpotSymbol,
            tx,
          );
          filled += 1;
        });
      } catch (err) {
        console.error("[spot-matching] fill failed:", (err as Error).message);
      }
    }

    return filled;
  }
}

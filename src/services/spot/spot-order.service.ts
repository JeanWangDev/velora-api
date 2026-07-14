import type { Transaction } from "sequelize";
import { Op } from "sequelize";
import { config } from "@/config";
import {
  SpotOrder,
  SpotSymbol,
  SpotTrade,
  type SpotOrderSide,
  type SpotTimeInForce,
} from "@/db";
import { BadRequestError, NotFoundError } from "@/errors/app-error";
import { AccountService, roundAmount } from "@/services/account";
import { SpotMatchingEngine } from "@/services/spot/spot-matching.engine";
import { SpotSymbolService } from "@/services/spot/spot-symbol.service";
import { RiskService } from "@/services/futures/futures-order.service";
import { pushAccountRefresh, pushOrderRefresh } from "@/ws/private-broadcast";

const EPSILON = 1e-9;

export interface PlaceOrderInput {
  symbol: string;
  side: SpotOrderSide;
  type: "limit" | "market";
  price: number | null;
  quantity: number;
  timeInForce?: SpotTimeInForce;
}

function remainingQty(order: SpotOrder): number {
  return roundAmount(Number(order.quantity) - Number(order.filledQuantity));
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

export class SpotOrderService {
  /** 下单：CLOB 撮合 + 市价 LP 兜底 */
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

    // 价格保护：限价偏离最新价超过 15% 拒绝
    if (limitPrice !== null && lastPrice > 0) {
      const deviation = Math.abs(limitPrice - lastPrice) / lastPrice;
      if (deviation > 0.15) {
        throw new BadRequestError(
          `限价偏离最新价 ${(deviation * 100).toFixed(1)}%，超过 15% 价格保护带`,
        );
      }
    }

    await RiskService.checkSpotOrder(
      userId,
      meta.symbol,
      quantity,
      limitPrice ?? lastPrice,
    );

    const timeInForce: SpotTimeInForce =
      input.type === "limit" ? (input.timeInForce ?? "gtc") : "gtc";

    if (timeInForce === "post_only" && limitPrice !== null) {
      await this.assertPostOnly(meta.symbol, input.side, limitPrice, userId);
    }
    if (timeInForce === "fok" && limitPrice !== null) {
      const liq = await this.sumOppositeLiquidity(
        meta.symbol,
        input.side,
        limitPrice,
        userId,
      );
      if (liq + EPSILON < quantity) {
        throw new BadRequestError("FOK 订单无法在当前盘口完全成交");
      }
    }

    const order = await AccountService.runInTransaction(async (tx) => {
      const created = await SpotOrder.create(
        {
          orderNo: genNo("SO"),
          userId,
          symbol: meta.symbol,
          side: input.side,
          type: input.type,
          timeInForce,
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

      if (input.type === "limit" && limitPrice !== null) {
        await this.freezeForLimit(created, limitPrice, quantity, meta, tx);
      } else {
        await this.assertImmediateBalance(userId, input.side, lastPrice, quantity, meta, tx);
      }

      await SpotMatchingEngine.matchOrder(created, meta, tx);
      await created.reload({ transaction: tx });

      const remain = remainingQty(created);
      if (
        timeInForce === "ioc" &&
        remain > EPSILON &&
        (created.status === "open" || created.status === "partial")
      ) {
        await this.releaseRemainder(created, tx);
        created.status = Number(created.filledQuantity) > EPSILON ? "filled" : "cancelled";
        await created.save({ transaction: tx });
      } else if (
        timeInForce === "fok" &&
        remain > EPSILON &&
        (created.status === "open" || created.status === "partial")
      ) {
        await this.releaseRemainder(created, tx);
        created.status = "cancelled";
        await created.save({ transaction: tx });
      }

      return created;
    });

    await order.reload();
    pushOrderRefresh(userId, "spot");
    pushAccountRefresh(userId);
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
        const totalQty = Number(order.quantity);
        const filledQty = Number(order.filledQuantity);
        const remainingRatio = roundAmount((totalQty - filledQty) / totalQty);
        const release = roundAmount(frozen * (remainingRatio > 0 ? remainingRatio : 1));
        if (release > EPSILON) {
          await AccountService.adjust(
            {
              userId,
              currency: order.frozenCurrency,
              availableDelta: release,
              frozenDelta: -release,
              ledgerType: "unfreeze",
              ledgerAmount: release,
              refId: order.orderNo,
            },
            tx,
          );
        }
      }

      order.frozenCurrency = "";
      order.frozenAmount = "0";
      order.status = "cancelled";
      await order.save({ transaction: tx });
      return order;
    });
  }

  /** 改单：取消原单后按新价格/数量重挂 */
  static async amendOrder(
    userId: number,
    input: { orderNo: string; price?: number | null; quantity?: number },
  ): Promise<SpotOrder> {
    assertDbReady();
    const open = await SpotOrder.findOne({
      where: {
        userId,
        orderNo: input.orderNo,
        status: { [Op.in]: ["open", "partial"] },
      },
    });
    if (!open) throw new NotFoundError("可改订单不存在");

    const remain = roundAmount(Number(open.quantity) - Number(open.filledQuantity));
    const newQty = input.quantity != null ? roundAmount(input.quantity) : remain;
    const newPrice =
      input.price !== undefined
        ? input.price == null
          ? null
          : roundAmount(input.price)
        : open.price != null
          ? Number(open.price)
          : null;

    if (!(newQty > 0)) throw new BadRequestError("改单数量无效");

    await this.cancelOrder(userId, open.orderNo);
    return this.placeOrder(userId, {
      symbol: open.symbol,
      side: open.side,
      type: newPrice != null ? "limit" : "market",
      price: newPrice,
      quantity: newQty,
      timeInForce: open.timeInForce ?? "gtc",
    });
  }

  /** Post Only：若会立即吃单则拒绝 */
  private static async assertPostOnly(
    symbol: string,
    side: SpotOrderSide,
    limitPrice: number,
    userId: number,
  ) {
    const opposite: SpotOrderSide = side === "buy" ? "sell" : "buy";
    const priceOp = side === "buy" ? Op.lte : Op.gte;
    const crossing = await SpotOrder.findOne({
      where: {
        symbol,
        side: opposite,
        status: { [Op.in]: ["open", "partial"] },
        type: "limit",
        price: { [priceOp]: limitPrice },
        userId: { [Op.ne]: userId },
      },
    });
    if (crossing) {
      throw new BadRequestError("Post Only 订单会立即成交，已拒绝");
    }
  }

  /** 统计对手盘可成交数量（不含自成交） */
  private static async sumOppositeLiquidity(
    symbol: string,
    side: SpotOrderSide,
    limitPrice: number,
    userId: number,
  ): Promise<number> {
    const opposite: SpotOrderSide = side === "buy" ? "sell" : "buy";
    const priceOp = side === "buy" ? Op.lte : Op.gte;
    const makers = await SpotOrder.findAll({
      where: {
        symbol,
        side: opposite,
        status: { [Op.in]: ["open", "partial"] },
        type: "limit",
        price: { [priceOp]: limitPrice },
        userId: { [Op.ne]: userId },
      },
    });
    return roundAmount(
      makers.reduce((sum, m) => sum + remainingQty(m), 0),
    );
  }

  /** IOC/FOK 未成交部分：释放冻结并撤单 */
  private static async releaseRemainder(order: SpotOrder, tx: Transaction) {
    const frozen = Number(order.frozenAmount);
    if (frozen > EPSILON && order.frozenCurrency) {
      const totalQty = Number(order.quantity);
      const filledQty = Number(order.filledQuantity);
      const remainQty = Math.max(0, totalQty - filledQty);
      const releaseRatio = totalQty > EPSILON ? remainQty / totalQty : 1;
      const release = roundAmount(frozen * releaseRatio);
      if (release > EPSILON) {
        await AccountService.adjust(
          {
            userId: order.userId,
            currency: order.frozenCurrency,
            availableDelta: release,
            frozenDelta: -release,
            ledgerType: "unfreeze",
            ledgerAmount: release,
            refId: order.orderNo,
          },
          tx,
        );
      }
    }
    order.frozenCurrency = "";
    order.frozenAmount = "0";
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
   * 撮合轮询：CLOB 用户间撮合 + 市价单 LP 兜底
   */
  static async matchOpenOrders(): Promise<number> {
    return SpotMatchingEngine.matchOpenOrders();
  }
}

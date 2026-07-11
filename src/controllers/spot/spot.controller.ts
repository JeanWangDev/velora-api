import type { Context } from "koa";
import { toSpotOrderDto, toSpotTradeDto } from "@/dto/spot";
import { BadRequestError } from "@/errors/app-error";
import { requireAuthUser } from "@/middlewares/auth.middleware";
import { SpotOrderService, SpotSymbolService } from "@/services/spot";
import { SpotAlgoOrderService } from "@/services/spot/spot-algo-order.service";
import { SpotOrderBookService } from "@/services/spot/spot-orderbook.service";
import {
  cancelSpotOrderBodySchema,
  placeSpotOrderBodySchema,
  spotListQuerySchema,
  validateBody,
  validateQuery,
} from "@/validators";

function resolveUserId(ctx: Context): number {
  const authUser = requireAuthUser(ctx);
  const userId = Number(authUser.id);
  if (!Number.isFinite(userId)) {
    throw new BadRequestError("无效的用户身份");
  }
  return userId;
}

export class SpotController {
  /** 现货交易对列表（含精度、最小下单量、费率） */
  static async symbols(ctx: Context) {
    const data = await SpotSymbolService.list();
    ctx.sendSuccess({ data });
  }

  /** 合并订单簿：内部 CLOB + 外部流动性 */
  static async orderBook(ctx: Context) {
    const symbol = String(ctx.query.symbol ?? "").toUpperCase();
    const limit = Math.min(100, Math.max(5, Number(ctx.query.limit ?? 50)));
    if (!symbol) throw new BadRequestError("symbol is required");
    const book = await SpotOrderBookService.getMergedBook(symbol, limit);
    ctx.set("Cache-Control", "no-cache");
    ctx.sendSuccess(book);
  }

  /** 下单 */
  static async placeOrder(ctx: Context) {
    const userId = resolveUserId(ctx);
    const body = validateBody(placeSpotOrderBodySchema, ctx.request.body);
    const order = await SpotOrderService.placeOrder(userId, {
      symbol: body.symbol.toUpperCase(),
      side: body.side,
      type: body.type,
      price: body.price ?? null,
      quantity: body.quantity,
    });
    ctx.sendSuccess({ order: toSpotOrderDto(order) }, { message: "下单成功" });
  }

  /** 撤单 */
  static async cancelOrder(ctx: Context) {
    const userId = resolveUserId(ctx);
    const body = validateBody(cancelSpotOrderBodySchema, ctx.request.body);
    const order = await SpotOrderService.cancelOrder(userId, body.orderNo);
    ctx.sendSuccess({ order: toSpotOrderDto(order) }, { message: "已撤销" });
  }

  /** 当前委托 */
  static async openOrders(ctx: Context) {
    const userId = resolveUserId(ctx);
    const query = validateQuery(spotListQuerySchema, ctx.query);
    const rows = await SpotOrderService.listOpen(userId, query.symbol);
    ctx.sendSuccess({ data: rows.map(toSpotOrderDto) });
  }

  /** 历史委托 */
  static async historyOrders(ctx: Context) {
    const userId = resolveUserId(ctx);
    const query = validateQuery(spotListQuerySchema, ctx.query);
    const result = await SpotOrderService.listHistory(userId, query);
    ctx.sendSuccess({
      data: result.rows.map(toSpotOrderDto),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  }

  /** 成交记录 */
  static async trades(ctx: Context) {
    const userId = resolveUserId(ctx);
    const query = validateQuery(spotListQuerySchema, ctx.query);
    const result = await SpotOrderService.listTrades(userId, query);
    ctx.sendSuccess({
      data: result.rows.map(toSpotTradeDto),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  }

  /** 止盈止损 / 条件单 */
  static async placeAlgoOrder(ctx: Context) {
    const userId = resolveUserId(ctx);
    const body = ctx.request.body as {
      symbol?: string;
      side?: "buy" | "sell";
      algoType?: "stop_loss" | "take_profit";
      triggerPrice?: number;
      orderPrice?: number | null;
      quantity?: number;
    };
    const triggerPrice = Number(body.triggerPrice);
    const quantity = Number(body.quantity);
    if (!body.symbol || !body.side || !body.algoType || !(triggerPrice > 0) || !(quantity > 0)) {
      throw new BadRequestError("参数无效");
    }
    const data = await SpotAlgoOrderService.place({
      userId,
      symbol: body.symbol.toUpperCase(),
      side: body.side,
      algoType: body.algoType,
      triggerPrice,
      orderPrice: body.orderPrice ?? null,
      quantity,
    });
    ctx.sendSuccess(data, { message: "条件单已提交" });
  }

  static async listAlgoOrders(ctx: Context) {
    const userId = resolveUserId(ctx);
    const symbol = ctx.query.symbol ? String(ctx.query.symbol).toUpperCase() : undefined;
    const data = await SpotAlgoOrderService.listActive(userId, symbol);
    ctx.sendSuccess({ data });
  }

  static async algoHistory(ctx: Context) {
    const userId = resolveUserId(ctx);
    const page = Number(ctx.query.page ?? 1);
    const pageSize = Number(ctx.query.pageSize ?? 50);
    const data = await SpotAlgoOrderService.listHistory(userId, page, pageSize);
    ctx.sendSuccess(data);
  }

  static async cancelAlgoOrder(ctx: Context) {
    const userId = resolveUserId(ctx);
    const body = ctx.request.body as { algoNo?: string };
    if (!body.algoNo) throw new BadRequestError("参数无效");
    const data = await SpotAlgoOrderService.cancel(userId, body.algoNo);
    ctx.sendSuccess(data, { message: "已撤销条件单" });
  }
}

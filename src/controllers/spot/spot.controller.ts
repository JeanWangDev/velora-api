import type { Context } from "koa";
import { toSpotOrderDto, toSpotTradeDto } from "@/dto/spot";
import { BadRequestError } from "@/errors/app-error";
import { requireAuthUser } from "@/middlewares/auth.middleware";
import { SpotOrderService, SpotSymbolService } from "@/services/spot";
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
}

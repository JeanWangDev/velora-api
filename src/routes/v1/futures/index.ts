import Router from "@koa/router";
import type { Context } from "koa";
import { z } from "zod";
import { BadRequestError } from "@/errors/app-error";
import { requireAuthUser } from "@/middlewares/auth.middleware";
import { FuturesOrderService } from "@/services/futures/futures-order.service";
import { FuturesSymbolService } from "@/services/futures/futures-symbol.service";

function resolveUserId(ctx: Context): number {
  const authUser = requireAuthUser(ctx);
  const userId = Number(authUser.id);
  if (!Number.isFinite(userId)) throw new BadRequestError("无效的用户身份");
  return userId;
}

export class FuturesController {
  static async placeOrder(ctx: Context) {
    const userId = resolveUserId(ctx);
    const schema = z.object({
      symbol: z.string().min(1),
      side: z.enum(["buy", "sell"]),
      posSide: z.enum(["long", "short"]),
      type: z.enum(["limit", "market"]),
      price: z.number().nullable().optional(),
      quantity: z.number().positive(),
      leverage: z.number().int().min(1).max(125).default(10),
      marginMode: z.enum(["cross", "isolated"]).default("cross"),
      reduceOnly: z.boolean().optional(),
    });
    const parsed = schema.safeParse(ctx.request.body);
    if (!parsed.success) throw new BadRequestError("参数无效");
    const data = await FuturesOrderService.placeOrder({
      userId,
      ...parsed.data,
      price: parsed.data.price ?? null,
    });
    ctx.sendSuccess(data, { message: "合约下单成功" });
  }

  static async cancelOrder(ctx: Context) {
    const userId = resolveUserId(ctx);
    const schema = z.object({ orderNo: z.string().min(1) });
    const parsed = schema.safeParse(ctx.request.body);
    if (!parsed.success) throw new BadRequestError("参数无效");
    const data = await FuturesOrderService.cancelOrder(userId, parsed.data.orderNo);
    ctx.sendSuccess(data, { message: "已撤销" });
  }

  static async openOrders(ctx: Context) {
    const userId = resolveUserId(ctx);
    const symbol = ctx.query.symbol ? String(ctx.query.symbol).toUpperCase() : undefined;
    const data = await FuturesOrderService.listOpenOrders(userId, symbol);
    ctx.sendSuccess({ data });
  }

  static async historyOrders(ctx: Context) {
    const userId = resolveUserId(ctx);
    const page = Number(ctx.query.page ?? 1);
    const pageSize = Number(ctx.query.pageSize ?? 50);
    const symbol = ctx.query.symbol ? String(ctx.query.symbol).toUpperCase() : undefined;
    const data = await FuturesOrderService.listOrderHistory(userId, page, pageSize, symbol);
    ctx.sendSuccess(data);
  }

  static async positions(ctx: Context) {
    const userId = resolveUserId(ctx);
    const data = await FuturesOrderService.listPositions(userId);
    ctx.sendSuccess({ data });
  }

  static async symbols(ctx: Context) {
    const data = await FuturesSymbolService.list();
    ctx.sendSuccess({ data });
  }

  static async markPrices(ctx: Context) {
    const data = await FuturesOrderService.listMarkPrices();
    ctx.sendSuccess({ data });
  }
}

const router = new Router({ prefix: "/futures" });
router.post("/order", FuturesController.placeOrder);
router.post("/order/cancel", FuturesController.cancelOrder);
router.get("/orders/open", FuturesController.openOrders);
router.get("/orders/history", FuturesController.historyOrders);
router.get("/positions", FuturesController.positions);
router.get("/symbols", FuturesController.symbols);
router.get("/mark-prices", FuturesController.markPrices);

export default router;

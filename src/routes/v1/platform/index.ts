import Router from "@koa/router";
import type { Context } from "koa";
import { BadRequestError } from "@/errors/app-error";
import { requireAuthUser } from "@/middlewares/auth.middleware";
import { EarnService, MarginService, UnifiedAccountService } from "@/services/platform/earn.service";
import { OptionService, QuickBuyService } from "@/services/platform/options.service";
import { TierService, SettlementService, DepositWatcherService, AmlService, KybService } from "@/services/platform/compliance.service";
import { InsuranceFundService } from "@/services/futures/adl.service";

function uid(ctx: Context): number {
  const id = Number(requireAuthUser(ctx).id);
  if (!Number.isFinite(id)) throw new BadRequestError("无效用户");
  return id;
}

const router = new Router({ prefix: "/platform" });

router.get("/earn/products", async (ctx) => {
  ctx.sendSuccess({ data: await EarnService.listProducts() });
});
router.get("/earn/positions", async (ctx) => {
  ctx.sendSuccess({ data: await EarnService.listPositions(uid(ctx)) });
});
router.post("/earn/subscribe", async (ctx) => {
  const body = ctx.request.body as { productNo?: string; amount?: number };
  if (!body.productNo || !(Number(body.amount) > 0)) throw new BadRequestError("参数无效");
  ctx.sendSuccess(await EarnService.subscribe(uid(ctx), body.productNo, Number(body.amount)));
});
router.post("/earn/redeem", async (ctx) => {
  const body = ctx.request.body as { positionId?: number };
  if (!body.positionId) throw new BadRequestError("参数无效");
  ctx.sendSuccess(await EarnService.redeem(uid(ctx), body.positionId));
});

router.get("/margin/summary", async (ctx) => {
  ctx.sendSuccess(await MarginService.getSummary(uid(ctx)));
});
router.post("/margin/borrow", async (ctx) => {
  const body = ctx.request.body as { currency?: string; amount?: number };
  if (!body.currency || !(Number(body.amount) > 0)) throw new BadRequestError("参数无效");
  ctx.sendSuccess(await MarginService.borrow(uid(ctx), body.currency, Number(body.amount)));
});
router.post("/margin/repay", async (ctx) => {
  const body = ctx.request.body as { loanId?: number };
  if (!body.loanId) throw new BadRequestError("参数无效");
  ctx.sendSuccess(await MarginService.repay(uid(ctx), body.loanId));
});

router.get("/unified/mode", async (ctx) => {
  ctx.sendSuccess({ mode: await UnifiedAccountService.getMode(uid(ctx)) });
});
router.post("/unified/mode", async (ctx) => {
  const body = ctx.request.body as { mode?: "classic" | "unified" };
  if (body.mode !== "classic" && body.mode !== "unified") throw new BadRequestError("参数无效");
  ctx.sendSuccess(await UnifiedAccountService.setMode(uid(ctx), body.mode));
});
router.get("/unified/equity", async (ctx) => {
  ctx.sendSuccess(await UnifiedAccountService.getEquity(uid(ctx)));
});

router.get("/options/instruments", async (ctx) => {
  ctx.sendSuccess({ data: await OptionService.listInstruments() });
});
router.get("/options/positions", async (ctx) => {
  ctx.sendSuccess({ data: await OptionService.listPositions(uid(ctx)) });
});
router.post("/options/order", async (ctx) => {
  const body = ctx.request.body as { symbol?: string; side?: "buy" | "sell"; quantity?: number };
  if (!body.symbol || !body.side || !(Number(body.quantity) > 0)) throw new BadRequestError("参数无效");
  ctx.sendSuccess(await OptionService.placeOrder({
    userId: uid(ctx),
    symbol: body.symbol,
    side: body.side,
    quantity: Number(body.quantity),
  }));
});

router.post("/quick-buy/quote", async (ctx) => {
  const body = ctx.request.body as { fiatAmount?: number; crypto?: string };
  ctx.sendSuccess(await QuickBuyService.createQuote(Number(body.fiatAmount), body.crypto));
});
router.post("/quick-buy/order", async (ctx) => {
  const body = ctx.request.body as { fiatAmount?: number; crypto?: string };
  ctx.sendSuccess(await QuickBuyService.createOrder(uid(ctx), Number(body.fiatAmount), body.crypto));
});
router.post("/quick-buy/confirm", async (ctx) => {
  const body = ctx.request.body as { orderNo?: string };
  if (!body.orderNo) throw new BadRequestError("参数无效");
  ctx.sendSuccess(await QuickBuyService.confirmPayment(uid(ctx), body.orderNo));
});
router.get("/quick-buy/orders", async (ctx) => {
  ctx.sendSuccess({ data: await QuickBuyService.listOrders(uid(ctx)) });
});

router.get("/account/tier", async (ctx) => {
  ctx.sendSuccess(await TierService.getUserTier(uid(ctx)));
});

router.post("/kyb/submit", async (ctx) => {
  const body = ctx.request.body as { companyName?: string; regNo?: string; contactName?: string };
  if (!body.companyName) throw new BadRequestError("请填写企业名称");
  ctx.sendSuccess(await KybService.submit({
    userId: uid(ctx),
    companyName: body.companyName,
    regNo: body.regNo ?? "",
    contactName: body.contactName ?? "",
  }));
});
router.get("/kyb/status", async (ctx) => {
  ctx.sendSuccess(await KybService.getStatus(uid(ctx)));
});

export default router;

export const adminPlatformRouter = new Router({ prefix: "/admin/platform" });

adminPlatformRouter.get("/settlement/batches", async (ctx) => {
  ctx.sendSuccess({ data: await SettlementService.listBatches() });
});
adminPlatformRouter.post("/settlement/run", async (ctx) => {
  const batchNo = await SettlementService.runDailyBatch();
  ctx.sendSuccess({ batchNo });
});
adminPlatformRouter.get("/insurance-fund", async (ctx) => {
  ctx.sendSuccess({ data: await InsuranceFundService.listBalances() });
});
adminPlatformRouter.get("/aml/alerts", async (ctx) => {
  ctx.sendSuccess({ data: await AmlService.listAlerts(undefined, 100) });
});
adminPlatformRouter.post("/kyb/review", async (ctx) => {
  const body = ctx.request.body as { userId?: number; approve?: boolean; reason?: string };
  if (!body.userId) throw new BadRequestError("参数无效");
  ctx.sendSuccess(await KybService.adminReview(body.userId, Boolean(body.approve), body.reason));
});
adminPlatformRouter.post("/deposit/scan", async (ctx) => {
  ctx.sendSuccess({ matched: await DepositWatcherService.scanTrc20Deposits() });
});

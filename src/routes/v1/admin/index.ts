import Router from "@koa/router";
import type { Context } from "koa";
import { AdminTradingSymbolController, AdminUserController, AdminFinanceController, AdminWithdrawController } from "@/controllers/admin";
import { AdminAnnouncementController } from "@/controllers/admin/admin-announcement.controller";
import { AdminBillingOrderController } from "@/controllers/admin/admin-billing-order.controller";
import { BadRequestError } from "@/errors/app-error";
import { SupportTicketService } from "@/services/support/support-ticket.service";
import { adminPlatformRouter } from "../platform";

const router = new Router({ prefix: "/admin" });

router.get("/trading-pairs", AdminTradingSymbolController.list);
router.post("/trading-pairs", AdminTradingSymbolController.create);
router.post("/trading-pairs/update", AdminTradingSymbolController.update);
router.post("/trading-pairs/remove", AdminTradingSymbolController.remove);
router.post("/trading-pairs/sync-spot", AdminTradingSymbolController.syncSpotFromBinance);

router.get("/roles", AdminUserController.listRoles);
router.get("/users", AdminUserController.list);
router.post("/users", AdminUserController.create);
router.post("/users/update-role", AdminUserController.updateRole);
router.post("/users/update-status", AdminUserController.updateStatus);

router.get("/billing/orders", AdminBillingOrderController.list);

router.post("/finance/credit", AdminFinanceController.credit);
router.post("/finance/debit", AdminFinanceController.debit);
router.get("/finance/ops", AdminFinanceController.listOps);
router.get("/finance/user-balances", AdminFinanceController.userBalances);

router.get("/withdrawals/pending", AdminWithdrawController.listPending);
router.post("/withdrawals/approve", AdminWithdrawController.approve);
router.post("/withdrawals/reject", AdminWithdrawController.reject);
router.post("/deposits/confirm", AdminWithdrawController.confirmDeposit);

router.get("/announcements", AdminAnnouncementController.list);
router.post("/announcements", AdminAnnouncementController.create);
router.post("/announcements/update", AdminAnnouncementController.update);
router.post("/announcements/remove", AdminAnnouncementController.remove);

router.get("/support/tickets", async (ctx: Context) => {
  const page = Number(ctx.query.page ?? 1);
  const pageSize = Number(ctx.query.pageSize ?? 50);
  ctx.sendSuccess(await SupportTicketService.adminList(page, pageSize));
});
router.post("/support/reply", async (ctx: Context) => {
  const body = ctx.request.body as {
    ticketNo?: string;
    reply?: string;
    close?: boolean;
  };
  if (!body.ticketNo || !body.reply) throw new BadRequestError("参数无效");
  ctx.sendSuccess(
    await SupportTicketService.adminReply(
      body.ticketNo,
      body.reply,
      Boolean(body.close),
    ),
  );
});

router.use(adminPlatformRouter.routes(), adminPlatformRouter.allowedMethods());

export default router;

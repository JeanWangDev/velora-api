import Router from "@koa/router";
import type { Context } from "koa";
import { z } from "zod";
import { BadRequestError } from "@/errors/app-error";
import { requireAuthUser } from "@/middlewares/auth.middleware";
import { SupportTicketService } from "@/services/support/support-ticket.service";

function resolveUserId(ctx: Context): number {
  const authUser = requireAuthUser(ctx);
  const userId = Number(authUser.id);
  if (!Number.isFinite(userId)) throw new BadRequestError("无效的用户身份");
  return userId;
}

export class SupportController {
  static async create(ctx: Context) {
    const userId = resolveUserId(ctx);
    const schema = z.object({
      category: z.string().optional(),
      subject: z.string().min(1),
      body: z.string().min(1),
    });
    const parsed = schema.safeParse(ctx.request.body);
    if (!parsed.success) throw new BadRequestError("参数无效");
    const data = await SupportTicketService.create(userId, parsed.data);
    ctx.sendSuccess(data, { message: "工单已提交" });
  }

  static async list(ctx: Context) {
    const data = await SupportTicketService.listForUser(resolveUserId(ctx));
    ctx.sendSuccess({ data });
  }

  static async getByNo(ctx: Context) {
    const ticketNo = String(ctx.params.ticketNo ?? "");
    const data = await SupportTicketService.getForUser(resolveUserId(ctx), ticketNo);
    ctx.sendSuccess(data);
  }
}

const router = new Router({ prefix: "/support" });
router.post("/tickets", SupportController.create);
router.get("/tickets", SupportController.list);
router.get("/tickets/:ticketNo", SupportController.getByNo);

export default router;

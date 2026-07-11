import type { Context } from "koa";
import { z } from "zod";
import { BadRequestError } from "@/errors/app-error";
import { requireAuthUser } from "@/middlewares/auth.middleware";
import { NotificationService } from "@/services/notification/notification.service";

function resolveUserId(ctx: Context): number {
  const authUser = requireAuthUser(ctx);
  const userId = Number(authUser.id);
  if (!Number.isFinite(userId)) throw new BadRequestError("无效的用户身份");
  return userId;
}

export class NotificationController {
  static async list(ctx: Context) {
    const userId = resolveUserId(ctx);
    const page = Number(ctx.query.page ?? 1);
    const pageSize = Number(ctx.query.pageSize ?? 30);
    const data = await NotificationService.list(userId, page, pageSize);
    ctx.sendSuccess(data);
  }

  static async markRead(ctx: Context) {
    const userId = resolveUserId(ctx);
    const schema = z.object({ ids: z.array(z.number().int().positive()).min(1) });
    const parsed = schema.safeParse(ctx.request.body);
    if (!parsed.success) throw new BadRequestError("参数无效");
    await NotificationService.markRead(userId, parsed.data.ids);
    ctx.sendSuccess({ ok: true });
  }
}

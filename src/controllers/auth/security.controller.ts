import type { Context } from "koa";
import { BadRequestError } from "@/errors/app-error";
import { requireAuthUser } from "@/middlewares/auth.middleware";
import { SecurityService } from "@/services/auth/security.service";
import { z } from "zod";

const codeSchema = z.object({ code: z.string().min(6).max(8) });
const changePasswordSchema = z.object({
  currentPassword: z.string().min(6),
  newPassword: z.string().min(8),
});

export class SecurityController {
  static async status2fa(ctx: Context) {
    const user = requireAuthUser(ctx);
    const data = await SecurityService.get2faStatus(Number(user.id));
    ctx.sendSuccess(data);
  }

  static async setup2fa(ctx: Context) {
    const user = requireAuthUser(ctx);
    const data = await SecurityService.setup2fa(Number(user.id), user.email ?? "");
    ctx.sendSuccess(data);
  }

  static async verify2fa(ctx: Context) {
    const user = requireAuthUser(ctx);
    const parsed = codeSchema.safeParse(ctx.request.body);
    if (!parsed.success) throw new BadRequestError("验证码格式错误");
    const data = await SecurityService.verifyAndEnable2fa(
      Number(user.id),
      parsed.data.code,
    );
    ctx.sendSuccess(data);
  }

  static async disable2fa(ctx: Context) {
    const user = requireAuthUser(ctx);
    const parsed = codeSchema.safeParse(ctx.request.body);
    if (!parsed.success) throw new BadRequestError("验证码格式错误");
    const data = await SecurityService.disable2fa(Number(user.id), parsed.data.code);
    ctx.sendSuccess(data);
  }

  static async changePassword(ctx: Context) {
    const user = requireAuthUser(ctx);
    const parsed = changePasswordSchema.safeParse(ctx.request.body);
    if (!parsed.success) throw new BadRequestError(parsed.error.message);
    const data = await SecurityService.changePassword(
      Number(user.id),
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );
    ctx.sendSuccess(data);
  }

  static async loginHistory(ctx: Context) {
    const user = requireAuthUser(ctx);
    const rows = await SecurityService.listLoginHistory(Number(user.id));
    ctx.sendSuccess({ rows });
  }
}

import type { Context } from "koa";
import { z } from "zod";
import { BadRequestError } from "@/errors/app-error";
import { requireAuthUser } from "@/middlewares/auth.middleware";
import { requireAdmin } from "@/middlewares/require-admin.middleware";
import { AdminWithdrawService } from "@/services/wallet/admin-withdraw.service";

function resolveUserId(ctx: Context): number {
  const authUser = requireAuthUser(ctx);
  return Number(authUser.id);
}

export class AdminWithdrawController {
  static async listPending(ctx: Context) {
    requireAdmin(ctx);
    const page = Number(ctx.query.page ?? 1);
    const pageSize = Number(ctx.query.pageSize ?? 50);
    const data = await AdminWithdrawService.listPending(page, pageSize);
    ctx.sendSuccess(data);
  }

  static async approve(ctx: Context) {
    requireAdmin(ctx);
    const schema = z.object({
      withdrawNo: z.string().min(1),
      txHash: z.string().optional(),
    });
    const parsed = schema.safeParse(ctx.request.body);
    if (!parsed.success) throw new BadRequestError("参数无效");
    const data = await AdminWithdrawService.approve(
      parsed.data.withdrawNo,
      resolveUserId(ctx),
      parsed.data.txHash,
    );
    ctx.sendSuccess(data, { message: "提现已批准" });
  }

  static async reject(ctx: Context) {
    requireAdmin(ctx);
    const schema = z.object({
      withdrawNo: z.string().min(1),
      reason: z.string().optional(),
    });
    const parsed = schema.safeParse(ctx.request.body);
    if (!parsed.success) throw new BadRequestError("参数无效");
    const data = await AdminWithdrawService.reject(
      parsed.data.withdrawNo,
      resolveUserId(ctx),
      parsed.data.reason ?? "",
    );
    ctx.sendSuccess(data, { message: "提现已拒绝" });
  }

  static async confirmDeposit(ctx: Context) {
    requireAdmin(ctx);
    const schema = z.object({
      userId: z.number().int().positive(),
      currency: z.string().min(1),
      chain: z.string().min(1),
      amount: z.number().positive(),
      txHash: z.string().min(1),
    });
    const parsed = schema.safeParse(ctx.request.body);
    if (!parsed.success) throw new BadRequestError("参数无效");
    const data = await AdminWithdrawService.confirmDeposit({
      ...parsed.data,
      operatorId: resolveUserId(ctx),
    });
    ctx.sendSuccess(data, { message: "充币已确认入账" });
  }
}

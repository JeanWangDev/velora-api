import type { Context } from "koa";
import { BadRequestError } from "@/errors/app-error";
import { requireAdmin } from "@/middlewares/require-admin.middleware";
import { AdminFinanceService } from "@/services/admin/admin-finance.service";
import {
  adminFinanceCreditBodySchema,
  adminFinanceDebitBodySchema,
  adminFinanceListQuerySchema,
  adminFinanceUserQuerySchema,
  validateBody,
  validateQuery,
} from "@/validators";

function actorId(ctx: Context): number {
  const user = requireAdmin(ctx);
  const id = Number(user.id);
  if (!Number.isFinite(id) || id <= 0) {
    throw new BadRequestError("无效的管理员身份");
  }
  return id;
}

export class AdminFinanceController {
  /** 模拟充值 */
  static async credit(ctx: Context) {
    const operatorId = actorId(ctx);
    const body = validateBody(adminFinanceCreditBodySchema, ctx.request.body);
    const result = await AdminFinanceService.credit(
      body.userId,
      body.currency,
      body.amount,
      operatorId,
      body.remark,
    );
    ctx.sendSuccess(result, { message: "充值成功" });
  }

  /** 模拟扣减 */
  static async debit(ctx: Context) {
    const operatorId = actorId(ctx);
    const body = validateBody(adminFinanceDebitBodySchema, ctx.request.body);
    const result = await AdminFinanceService.debit(
      body.userId,
      body.currency,
      body.amount,
      operatorId,
      body.remark,
    );
    ctx.sendSuccess(result, { message: "扣减成功" });
  }

  /** 资金操作记录 */
  static async listOps(ctx: Context) {
    requireAdmin(ctx);
    const query = validateQuery(adminFinanceListQuerySchema, ctx.query);
    const result = await AdminFinanceService.listOps(query);
    ctx.sendSuccess({
      data: result.rows,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  }

  /** 查询用户资产 */
  static async userBalances(ctx: Context) {
    requireAdmin(ctx);
    const query = validateQuery(adminFinanceUserQuerySchema, ctx.query);
    const result = await AdminFinanceService.getUserBalances(query.userId);
    ctx.sendSuccess(result);
  }
}

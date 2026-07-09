import type { Context } from "koa";
import { BadRequestError } from "@/errors/app-error";
import { requireAuthUser } from "@/middlewares/auth.middleware";
import { AccountService } from "@/services/account";
import { accountLedgerQuerySchema, validateQuery } from "@/validators";

function resolveUserId(ctx: Context): number {
  const authUser = requireAuthUser(ctx);
  const userId = Number(authUser.id);
  if (!Number.isFinite(userId)) {
    throw new BadRequestError("无效的用户身份");
  }
  return userId;
}

export class AccountController {
  /** 当前用户余额 */
  static async balances(ctx: Context) {
    const userId = resolveUserId(ctx);
    const balances = await AccountService.getBalances(userId);
    ctx.sendSuccess({ balances });
  }

  /** 资金流水（分页） */
  static async ledger(ctx: Context) {
    const userId = resolveUserId(ctx);
    const query = validateQuery(accountLedgerQuerySchema, ctx.query);
    const result = await AccountService.getLedger(userId, query);
    ctx.sendSuccess({
      data: result.rows,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  }
}

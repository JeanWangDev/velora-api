import type { Context } from "koa";
import { z } from "zod";
import { BadRequestError } from "@/errors/app-error";
import { requireAuthUser } from "@/middlewares/auth.middleware";
import { TransferService, WalletService } from "@/services/wallet/wallet.service";

function resolveUserId(ctx: Context): number {
  const authUser = requireAuthUser(ctx);
  const userId = Number(authUser.id);
  if (!Number.isFinite(userId)) throw new BadRequestError("无效的用户身份");
  return userId;
}

const depositAddressSchema = z.object({
  currency: z.string().min(1),
  chain: z.string().min(1),
});

const withdrawSchema = z.object({
  currency: z.string().min(1),
  chain: z.string().min(1),
  amount: z.number().positive(),
  address: z.string().min(10),
  memo: z.string().optional(),
});

export class WalletController {
  static async depositAddress(ctx: Context) {
    const userId = resolveUserId(ctx);
    const parsed = depositAddressSchema.safeParse(ctx.query);
    if (!parsed.success) throw new BadRequestError("参数无效");
    const data = await WalletService.getDepositAddress(
      userId,
      parsed.data.currency,
      parsed.data.chain,
    );
    ctx.sendSuccess(data);
  }

  static async withdraw(ctx: Context) {
    const userId = resolveUserId(ctx);
    const parsed = withdrawSchema.safeParse(ctx.request.body);
    if (!parsed.success) throw new BadRequestError("参数无效");
    const data = await WalletService.requestWithdraw({ userId, ...parsed.data });
    ctx.sendSuccess(data, { message: "提现申请已提交" });
  }

  static async deposits(ctx: Context) {
    const userId = resolveUserId(ctx);
    const page = Number(ctx.query.page ?? 1);
    const pageSize = Number(ctx.query.pageSize ?? 20);
    const data = await WalletService.listDeposits(userId, page, pageSize);
    ctx.sendSuccess(data);
  }

  static async withdrawals(ctx: Context) {
    const userId = resolveUserId(ctx);
    const page = Number(ctx.query.page ?? 1);
    const pageSize = Number(ctx.query.pageSize ?? 20);
    const data = await WalletService.listWithdrawals(userId, page, pageSize);
    ctx.sendSuccess(data);
  }

  static async transfers(ctx: Context) {
    const userId = resolveUserId(ctx);
    const page = Number(ctx.query.page ?? 1);
    const pageSize = Number(ctx.query.pageSize ?? 20);
    const data = await TransferService.listTransfers(userId, page, pageSize);
    ctx.sendSuccess(data);
  }

  static async chains(ctx: Context) {
    ctx.sendSuccess({ chains: WalletService.listChains() });
  }

  static async transfer(ctx: Context) {
    const userId = resolveUserId(ctx);
    const schema = z.object({
      currency: z.string().min(1),
      amount: z.number().positive(),
      fromAccount: z.enum(["funding", "trading", "futures"]),
      toAccount: z.enum(["funding", "trading", "futures"]),
    });
    const parsed = schema.safeParse(ctx.request.body);
    if (!parsed.success) throw new BadRequestError("参数无效");
    const data = await TransferService.transfer({ userId, ...parsed.data });
    ctx.sendSuccess(data, { message: "划转成功" });
  }
}

import type { Context } from "koa";
import { toAdminKycVerificationDto, toKycVerificationDto } from "@/dto/kyc";
import { BadRequestError } from "@/errors/app-error";
import { requireAuthUser } from "@/middlewares/auth.middleware";
import { requireAdmin } from "@/middlewares/require-admin.middleware";
import { KycService, KycUploadService } from "@/services/kyc";
import {
  adminKycListQuerySchema,
  reviewKycBodySchema,
  submitKycBodySchema,
  uploadKycBodySchema,
  validateBody,
  validateQuery,
} from "@/validators";

function resolveUserId(ctx: Context): number {
  const authUser = requireAuthUser(ctx);
  const userId = Number(authUser.id);
  if (!Number.isFinite(userId)) {
    throw new BadRequestError("无效的用户身份");
  }
  return userId;
}

export class KycController {
  /** 查询当前用户 KYC 状态 */
  static async me(ctx: Context) {
    const userId = resolveUserId(ctx);
    const row = await KycService.getForUser(userId);
    ctx.sendSuccess({ kyc: row ? toKycVerificationDto(row) : null });
  }

  /** 上传证件图片，返回可访问 URL */
  static async upload(ctx: Context) {
    const userId = resolveUserId(ctx);
    const body = validateBody(uploadKycBodySchema, ctx.request.body);
    const result = await KycUploadService.saveDataUrl(userId, body.side, body.image);
    ctx.sendSuccess(result);
  }

  /** 提交 / 重新提交 KYC */
  static async submit(ctx: Context) {
    const userId = resolveUserId(ctx);
    const body = validateBody(submitKycBodySchema, ctx.request.body);
    const row = await KycService.submit(userId, body);
    ctx.sendSuccess({ kyc: toKycVerificationDto(row) });
  }

  /** 管理员：分页查询 KYC 列表 */
  static async adminList(ctx: Context) {
    requireAdmin(ctx);
    const query = validateQuery(adminKycListQuerySchema, ctx.query);
    const result = await KycService.listForAdmin(query);
    ctx.sendSuccess({
      data: result.rows.map(toAdminKycVerificationDto),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  }

  /** 管理员审核 KYC（通过 / 拒绝） */
  static async review(ctx: Context) {
    requireAdmin(ctx);
    const body = validateBody(reviewKycBodySchema, ctx.request.body);
    const row = await KycService.review(body.userId, body.action, body.rejectReason);
    ctx.sendSuccess({ kyc: toKycVerificationDto(row, { maskId: false }) });
  }
}

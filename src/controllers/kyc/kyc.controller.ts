import type { Context } from "koa";
import { config } from "@/config";
import { toAdminKycVerificationDto, toKycVerificationDto } from "@/dto/kyc";
import { BadRequestError, UnauthorizedError } from "@/errors/app-error";
import { requireAuthUser } from "@/middlewares/auth.middleware";
import { requireAdmin } from "@/middlewares/require-admin.middleware";
import { KycService, KycUploadService } from "@/services/kyc";
import { verifyDiditWebhookSignature } from "@/services/didit";
import {
  adminKycListQuerySchema,
  diditCreateSessionBodySchema,
  diditSyncBodySchema,
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

  /** KYC 运行时配置（Didit / 开发自动通过） */
  static async config(ctx: Context) {
    ctx.sendSuccess({
      diditEnabled: KycService.isDiditEnabled(),
      devAutoApprove: KycService.isDevAutoApprove(),
    });
  }

  /** @deprecated 使用 config */
  static async diditConfig(ctx: Context) {
    await KycController.config(ctx);
  }

  /** 创建 Didit 验证会话，返回跳转 URL */
  static async diditCreateSession(ctx: Context) {
    const userId = resolveUserId(ctx);
    const body = validateBody(diditCreateSessionBodySchema, ctx.request.body ?? {});
    const result = await KycService.createDiditSession(userId, {
      callbackUrl: body.callbackUrl,
      language: body.language,
    });
    ctx.sendSuccess(result);
  }

  /** 从 Didit 同步验证结果（用户回调或手动刷新） */
  static async diditSync(ctx: Context) {
    const userId = resolveUserId(ctx);
    const body = validateBody(diditSyncBodySchema, ctx.request.body);
    const row = await KycService.syncFromDiditSession(userId, body.sessionId);
    ctx.sendSuccess({ kyc: toKycVerificationDto(row) });
  }

  /** Didit Webhook（公开，HMAC 签名校验） */
  static async diditWebhook(ctx: Context) {
    const secret = config.didit.webhookSecret;
    if (!secret.trim()) {
      throw new BadRequestError("Didit Webhook Secret 未配置");
    }

    const body = ctx.request.body as Record<string, unknown>;
    if (!body || typeof body !== "object") {
      throw new BadRequestError("无效的 Webhook 请求体");
    }

    const verified = verifyDiditWebhookSignature(body, {
      signatureV2: ctx.get("X-Signature-V2") || undefined,
      signatureSimple: ctx.get("X-Signature-Simple") || undefined,
      timestamp: ctx.get("X-Timestamp") || undefined,
    }, secret);

    if (!verified) {
      throw new UnauthorizedError("Didit Webhook 签名校验失败");
    }

    const payload = body as {
      session_id?: string;
      vendor_data?: string;
      status?: string;
      decision?: Record<string, unknown>;
    };

    void KycService.handleDiditWebhook(payload).catch((err) => {
      console.error("[didit/webhook] async handle failed:", err);
    });

    ctx.status = 200;
    ctx.body = { ok: true };
  }
}

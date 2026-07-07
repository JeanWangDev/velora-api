import { config } from "@/config";
import { KycVerification, User } from "@/db";
import { BadRequestError, NotFoundError } from "@/errors/app-error";
import type { KycStatus } from "@/db/models/kyc";
import type { SubmitKycBody } from "@/validators";
import {
  DiditService,
  parseDiditDecision,
  type ParsedDiditKyc,
} from "@/services/didit";

function assertDbReady() {
  if (!config.db.enabled) {
    throw new BadRequestError("数据库未启用");
  }
}

export class KycService {
  /** 获取用户当前 KYC 记录（不存在返回 null） */
  static async getForUser(userId: number): Promise<KycVerification | null> {
    assertDbReady();
    return KycVerification.findOne({ where: { userId } });
  }

  /**
   * 提交 / 重新提交 KYC。
   * - 已通过（verified）不允许再次提交
   * - 首次提交则创建，被拒后重提则覆盖并重置为 pending
   */
  static async submit(userId: number, body: SubmitKycBody): Promise<KycVerification> {
    assertDbReady();

    const existing = await KycVerification.findOne({ where: { userId } });
    if (existing && existing.status === "verified") {
      throw new BadRequestError("您已完成身份认证，无需重复提交");
    }

    const now = new Date();
    const autoApprove = config.kyc.devAutoApprove;
    const status: KycStatus = autoApprove ? "verified" : "pending";
    const payload = {
      userId,
      status,
      idType: body.idType,
      fullName: body.fullName,
      idNumber: body.idNumber,
      countryIso: body.countryIso || "CN",
      address: body.address ?? null,
      validUntil: body.validUntil ?? null,
      docFrontName: body.docFrontName ?? null,
      docBackName: body.docBackName ?? null,
      rejectReason: null,
      submittedAt: now,
      reviewedAt: autoApprove ? now : null,
    };

    if (existing) {
      await existing.update(payload);
      return existing;
    }

    return KycVerification.create(payload);
  }

  /** 管理端：分页查询 KYC 列表（可按状态过滤，含用户邮箱） */
  static async listForAdmin(options: {
    page?: number;
    pageSize?: number;
    status?: KycStatus;
  }): Promise<{
    rows: KycVerification[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    assertDbReady();

    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));
    const offset = (page - 1) * pageSize;
    const where = options.status ? { status: options.status } : {};

    const { rows, count } = await KycVerification.findAndCountAll({
      where,
      include: [{ model: User, as: "user", required: false }],
      order: [
        ["status", "ASC"],
        ["submittedAt", "DESC"],
      ],
      limit: pageSize,
      offset,
    });

    return { rows, total: count, page, pageSize };
  }

  /** 审核：通过或拒绝 */
  static async review(
    userId: number,
    action: "approve" | "reject",
    rejectReason?: string,
  ): Promise<KycVerification> {
    assertDbReady();

    const row = await KycVerification.findOne({ where: { userId } });
    if (!row) {
      throw new NotFoundError("该用户暂无 KYC 记录");
    }

    const now = new Date();
    if (action === "approve") {
      await row.update({ status: "verified", reviewedAt: now, rejectReason: null });
    } else {
      await row.update({
        status: "rejected",
        reviewedAt: now,
        rejectReason: rejectReason ?? "资料不清晰，请重新提交",
      });
    }

    return row;
  }

  /** 创建 Didit 验证会话 */
  static async createDiditSession(
    userId: number,
    options?: { callbackUrl?: string; language?: string },
  ): Promise<{ sessionId: string; url: string }> {
    assertDbReady();

    const existing = await KycVerification.findOne({ where: { userId } });
    if (existing?.status === "verified") {
      throw new BadRequestError("您已完成身份认证，无需重复提交");
    }

    const session = await DiditService.createSession({
      userId,
      callbackUrl: options?.callbackUrl,
      language: options?.language,
    });

    const now = new Date();
    const placeholder = {
      userId,
      status: "pending" as const,
      idType: "passport" as const,
      fullName: "—",
      idNumber: "—",
      countryIso: "US",
      address: null,
      validUntil: null,
      docFrontName: null,
      docBackName: null,
      diditSessionId: session.session_id,
      rejectReason: null,
      submittedAt: now,
      reviewedAt: null,
    };

    if (existing) {
      await existing.update(placeholder);
    } else {
      await KycVerification.create(placeholder);
    }

    return { sessionId: session.session_id, url: session.url };
  }

  /** 从 Didit 拉取决策并同步到本地 KYC 记录 */
  static async syncFromDiditSession(
    userId: number,
    sessionId: string,
  ): Promise<KycVerification> {
    assertDbReady();

    const row = await KycVerification.findOne({ where: { userId } });
    if (row?.diditSessionId && row.diditSessionId !== sessionId) {
      throw new BadRequestError("会话 ID 与当前用户不匹配");
    }

    const { status, decision } = await DiditService.getDecision(sessionId);
    const parsed = parseDiditDecision(decision, status);
    return KycService.applyDiditResult(userId, sessionId, parsed);
  }

  /** 处理 Didit Webhook（按 vendor_data = userId 定位用户） */
  static async handleDiditWebhook(payload: {
    session_id?: string;
    vendor_data?: string;
    status?: string;
    decision?: Record<string, unknown>;
  }): Promise<KycVerification | null> {
    assertDbReady();

    const userId = Number(payload.vendor_data);
    const sessionId = payload.session_id;
    if (!Number.isFinite(userId) || !sessionId) {
      return null;
    }

    let parsed: ParsedDiditKyc;
    if (payload.decision && typeof payload.decision === "object") {
      parsed = parseDiditDecision(
        payload.decision as Parameters<typeof parseDiditDecision>[0],
        payload.status,
      );
    } else {
      const remote = await DiditService.getDecision(sessionId);
      parsed = parseDiditDecision(remote.decision, remote.status);
    }

    return KycService.applyDiditResult(userId, sessionId, parsed);
  }

  private static async applyDiditResult(
    userId: number,
    sessionId: string,
    parsed: ParsedDiditKyc,
  ): Promise<KycVerification> {
    const now = new Date();
    const existing = await KycVerification.findOne({ where: { userId } });

    const payload = {
      userId,
      status: parsed.status,
      idType: parsed.idType,
      fullName: parsed.fullName,
      idNumber: parsed.idNumber,
      countryIso: parsed.countryIso,
      address: parsed.address ?? null,
      validUntil: parsed.validUntil ?? null,
      docFrontName: parsed.docFrontName ?? null,
      docBackName: parsed.docBackName ?? null,
      diditSessionId: sessionId,
      rejectReason: parsed.status === "rejected" ? (parsed.rejectReason ?? null) : null,
      submittedAt: existing?.submittedAt ?? now,
      reviewedAt:
        parsed.status === "verified" || parsed.status === "rejected" ? now : null,
    };

    if (existing) {
      await existing.update(payload);
      return existing;
    }

    return KycVerification.create(payload);
  }

  /** Didit 是否已配置可用 */
  static isDiditEnabled(): boolean {
    return DiditService.isEnabled();
  }

  /** 开发阶段是否自动通过 KYC */
  static isDevAutoApprove(): boolean {
    return config.kyc.devAutoApprove;
  }
}

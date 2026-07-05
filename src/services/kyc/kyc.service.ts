import { config } from "@/config";
import { KycVerification, User } from "@/db";
import { BadRequestError, NotFoundError } from "@/errors/app-error";
import type { KycStatus } from "@/db/models/kyc";
import type { SubmitKycBody } from "@/validators";

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
    const payload = {
      userId,
      status: "pending" as const,
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
      reviewedAt: null,
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
}

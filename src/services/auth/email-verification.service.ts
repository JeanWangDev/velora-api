import crypto from "crypto";
import { Op } from "sequelize";
import { config } from "@/config";
import { EmailVerification, User } from "@/db";
import { BadRequestError } from "@/errors/app-error";
import { MailService } from "@/services/mail/mail.service";
import { normalizeEmail } from "@/utils/password";

export const EMAIL_PURPOSE_REGISTER = "register";
export const EMAIL_PURPOSE_RESET_PASSWORD = "reset_password";

export type EmailVerificationPurpose =
  | typeof EMAIL_PURPOSE_REGISTER
  | typeof EMAIL_PURPOSE_RESET_PASSWORD;

/** 验证码有效期：给用户留出完成多步注册表单的时间，而不是 1 分钟就过期 */
const CODE_TTL_MS = 10 * 60_000;
const SEND_COOLDOWN_MS = 60_000;

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function generateCode(): string {
  return String(crypto.randomInt(100_000, 1_000_000));
}

export class EmailVerificationService {
  static async sendCode(emailInput: string, purpose: EmailVerificationPurpose) {
    const email = normalizeEmail(emailInput);
    const user = await User.findOne({ where: { email, status: 1 } });

    if (purpose === EMAIL_PURPOSE_REGISTER) {
      if (user) {
        throw new BadRequestError("该邮箱已注册");
      }
    } else if (!user) {
      throw new BadRequestError("该邮箱未注册");
    }

    const cooldownSince = new Date(Date.now() - SEND_COOLDOWN_MS);
    const recent = await EmailVerification.findOne({
      where: {
        email,
        purpose,
        createTime: { [Op.gte]: cooldownSince },
      },
      order: [["createTime", "DESC"]],
    });

    if (recent) {
      throw new BadRequestError("发送过于频繁，请 1 分钟后再试");
    }

    const code = generateCode();
    const expireTime = new Date(Date.now() + CODE_TTL_MS);

    await EmailVerification.update(
      { used: 1, usedTime: new Date() },
      { where: { email, purpose, used: 0 } },
    );

    await EmailVerification.create({
      email,
      purpose,
      codeHash: hashCode(code),
      expireTime,
      used: 0,
    });

    await MailService.sendVerificationCode(email, code);

    const result: { message: string; devCode?: string } = {
      message: "验证码已发送，请查收邮件（10 分钟内有效）",
    };

    if (config.isDev && !config.mail.enabled) {
      result.devCode = code;
    }

    return result;
  }

  /**
   * 只校验、不消费：用于前端在"输入验证码"这一步就给出真实反馈，
   * 而不是让用户带着一个从没被校验过的随便乱填的 6 位数字，
   * 一路走到设置密码那一步才在最终提交时才发现验证码是错的。
   * 真正标记 used=1（消费掉）仍然只在 verifyAndConsume（注册/重置密码提交时）里做，
   * 防止验证码被重放使用。
   */
  static async verifyOnly(
    emailInput: string,
    purpose: EmailVerificationPurpose,
    code: string,
  ): Promise<void> {
    const email = normalizeEmail(emailInput);
    const normalizedCode = code.trim();

    if (!/^\d{6}$/.test(normalizedCode)) {
      throw new BadRequestError("验证码格式不正确");
    }

    const row = await EmailVerification.findOne({
      where: {
        email,
        purpose,
        used: 0,
        expireTime: { [Op.gt]: new Date() },
      },
      order: [["createTime", "DESC"]],
    });

    if (!row || row.codeHash !== hashCode(normalizedCode)) {
      throw new BadRequestError("验证码错误或已过期");
    }
  }

  static async verifyAndConsume(
    emailInput: string,
    purpose: EmailVerificationPurpose,
    code: string,
  ): Promise<void> {
    const email = normalizeEmail(emailInput);
    const normalizedCode = code.trim();

    if (!/^\d{6}$/.test(normalizedCode)) {
      throw new BadRequestError("验证码格式不正确");
    }

    const row = await EmailVerification.findOne({
      where: {
        email,
        purpose,
        used: 0,
        expireTime: { [Op.gt]: new Date() },
      },
      order: [["createTime", "DESC"]],
    });

    if (!row || row.codeHash !== hashCode(normalizedCode)) {
      throw new BadRequestError("验证码错误或已过期");
    }

    row.used = 1;
    row.usedTime = new Date();
    await row.save();
  }
}

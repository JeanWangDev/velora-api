import { QueryTypes } from "sequelize";
import { User, UserPasswordHistory } from "@/db";
import { config } from "@/config";
import { getSequelize } from "@/db/connection";
import {
  BadRequestError,
  UnauthorizedError,
} from "@/errors/app-error";
import { hashPassword, verifyPassword } from "@/utils/password";
import { generateTotpSecret, getOtpAuthUrl, verifyTotp } from "@/utils/totp";
import { LoginSessionService } from "@/services/auth/login-session.service";

function assertDbReady() {
  if (!config.db.enabled) {
    throw new BadRequestError("数据库未启用");
  }
}

async function get2faRow(userId: number) {
  const sequelize = await getSequelize();
  if (!sequelize) return null;
  const rows = await sequelize.query<{ secret: string; enabled: number }>(
    `SELECT f_secret AS secret, f_enabled AS enabled
     FROM t_user_2fa WHERE f_user_id = :userId LIMIT 1`,
    { replacements: { userId }, type: QueryTypes.SELECT },
  );
  return rows[0] ?? null;
}

export class SecurityService {
  static async get2faStatus(userId: number) {
    assertDbReady();
    const row = await get2faRow(userId);
    return { enabled: Boolean(row?.enabled) };
  }

  static async setup2fa(userId: number, email: string) {
    assertDbReady();
    const existing = await get2faRow(userId);
    if (existing?.enabled) {
      throw new BadRequestError("两步验证已启用，请先关闭后再重新设置");
    }

    const secret = existing?.secret ?? generateTotpSecret();
    const sequelize = await getSequelize();
    if (!sequelize) throw new BadRequestError("数据库未启用");

    await sequelize.query(
      `INSERT INTO t_user_2fa (f_user_id, f_secret, f_enabled)
       VALUES (:userId, :secret, 0)
       ON DUPLICATE KEY UPDATE f_secret = :secret, f_enabled = 0`,
      { replacements: { userId, secret } },
    );

    return {
      secret,
      otpauthUrl: getOtpAuthUrl(secret, email),
    };
  }

  static async verifyAndEnable2fa(userId: number, code: string) {
    assertDbReady();
    const row = await get2faRow(userId);
    if (!row?.secret) {
      throw new BadRequestError("请先获取 2FA 密钥");
    }
    if (!verifyTotp(row.secret, code)) {
      throw new UnauthorizedError("验证码错误");
    }

    const sequelize = await getSequelize();
    await sequelize?.query(
      `UPDATE t_user_2fa SET f_enabled = 1 WHERE f_user_id = :userId`,
      { replacements: { userId } },
    );
    return { enabled: true };
  }

  static async disable2fa(userId: number, code: string) {
    assertDbReady();
    const row = await get2faRow(userId);
    if (!row?.enabled) {
      throw new BadRequestError("两步验证未启用");
    }
    if (!verifyTotp(row.secret, code)) {
      throw new UnauthorizedError("验证码错误");
    }

    const sequelize = await getSequelize();
    await sequelize?.query(
      `UPDATE t_user_2fa SET f_enabled = 0 WHERE f_user_id = :userId`,
      { replacements: { userId } },
    );
    return { enabled: false };
  }

  static async is2faEnabled(userId: number): Promise<boolean> {
    const row = await get2faRow(userId);
    return Boolean(row?.enabled);
  }

  static async verify2faCode(userId: number, code: string): Promise<boolean> {
    const row = await get2faRow(userId);
    if (!row?.enabled) return true;
    return verifyTotp(row.secret, code);
  }

  static async changePassword(
    userId: number,
    currentPassword: string,
    newPassword: string,
  ) {
    assertDbReady();

    const user = await User.findByPk(userId);
    if (!user || user.status !== 1) {
      throw new UnauthorizedError("登录状态已失效");
    }

    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedError("当前密码错误");
    }

    const lastHistory = await UserPasswordHistory.findOne({
      where: { userId },
      order: [["createTime", "DESC"]],
    });
    if (lastHistory && (await verifyPassword(newPassword, lastHistory.passwordHash))) {
      throw new BadRequestError("新密码不能与上一次密码相同");
    }

    const passwordHash = await hashPassword(newPassword);
    user.passwordHash = passwordHash;
    user.updateTime = new Date();
    await user.save();

    await UserPasswordHistory.create({
      userId,
      passwordHash,
      reason: "change",
    });

    return { ok: true };
  }

  static async listLoginHistory(userId: number) {
    return LoginSessionService.listForUser(userId);
  }
}

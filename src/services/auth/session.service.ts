import { QueryTypes } from "sequelize";
import { getSequelize } from "@/db/connection";
import { BadRequestError, UnauthorizedError } from "@/errors/app-error";
import { maskIp } from "@/utils/client-meta";

export class SessionService {
  static async listActive(userId: number) {
    const sequelize = await getSequelize();
    if (!sequelize) return [];
    const rows = await sequelize.query<{
      id: number;
      ip: string;
      device: string;
      jti: string;
      ts: number;
    }>(
      `SELECT f_id AS id, f_ip AS ip, f_device_label AS device, f_jti AS jti,
              UNIX_TIMESTAMP(f_create_time)*1000 AS ts
       FROM t_login_session
       WHERE f_user_id = :userId AND f_success = 1 AND f_revoked = 0
       ORDER BY f_id DESC LIMIT 30`,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
    return rows.map((r) => ({
      id: r.id,
      ip: maskIp(r.ip),
      device: r.device,
      jti: r.jti || null,
      ts: Number(r.ts),
    }));
  }

  static async revoke(userId: number, sessionId: number) {
    const sequelize = await getSequelize();
    if (!sequelize) throw new BadRequestError("数据库未启用");
    const [result] = await sequelize.query(
      `UPDATE t_login_session SET f_revoked = 1
       WHERE f_user_id = :userId AND f_id = :sessionId`,
      { replacements: { userId, sessionId } },
    );
    const affected = (result as { affectedRows?: number })?.affectedRows ?? 0;
    if (!affected) throw new UnauthorizedError("会话不存在");
    return { ok: true };
  }

  static async revokeAll(userId: number) {
    const sequelize = await getSequelize();
    if (!sequelize) return { ok: true };
    await sequelize.query(
      `UPDATE t_login_session SET f_revoked = 1
       WHERE f_user_id = :userId AND f_revoked = 0`,
      { replacements: { userId } },
    );
    return { ok: true };
  }
}

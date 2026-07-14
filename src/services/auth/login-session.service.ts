import { QueryTypes } from "sequelize";
import { getSequelize } from "@/db/connection";
import { maskIp } from "@/utils/client-meta";

export interface LoginSessionInput {
  userId: number;
  ip: string;
  userAgent: string;
  deviceLabel: string;
  success?: boolean;
}

export class LoginSessionService {
  static async record(input: LoginSessionInput) {
    const sequelize = await getSequelize();
    if (!sequelize) return;

    await sequelize.query(
      `INSERT INTO t_login_session (f_user_id, f_ip, f_user_agent, f_device_label, f_success)
       VALUES (:userId, :ip, :userAgent, :deviceLabel, :success)`,
      {
        replacements: {
          userId: input.userId,
          ip: input.ip.slice(0, 64),
          userAgent: input.userAgent.slice(0, 512),
          deviceLabel: input.deviceLabel.slice(0, 128),
          success: input.success === false ? 0 : 1,
        },
      },
    );
  }

  static async listForUser(userId: number, limit = 20) {
    const sequelize = await getSequelize();
    if (!sequelize) return [];

    const rows = await sequelize.query(
      `SELECT f_ip AS ip, f_device_label AS device,
              UNIX_TIMESTAMP(f_create_time)*1000 AS ts, f_success AS success
       FROM t_login_session
       WHERE f_user_id = :userId AND f_success = 1
       ORDER BY f_id DESC LIMIT :limit`,
      { replacements: { userId, limit }, type: QueryTypes.SELECT },
    );

    return (rows as { ip: string; device: string; ts: number; success: number }[]).map(
      (r) => ({
        ip: maskIp(r.ip),
        device: r.device,
        ts: Number(r.ts),
        success: Boolean(r.success),
      }),
    );
  }
}

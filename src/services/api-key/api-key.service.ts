import crypto from "crypto";
import { QueryTypes } from "sequelize";
import { getSequelize } from "@/db/connection";
import { BadRequestError, NotFoundError } from "@/errors/app-error";
import { encryptApiSecret } from "@/utils/api-key-crypto";

export class ApiKeyService {
  static async create(
    userId: number,
    label: string,
    permissions = "read,trade",
    ipWhitelist = "",
    symbolWhitelist = "",
  ) {
    const sequelize = await getSequelize();
    if (!sequelize) throw new BadRequestError("数据库未启用");

    const apiKey = `vk_${crypto.randomBytes(16).toString("hex")}`;
    const apiSecret = crypto.randomBytes(32).toString("hex");

    await sequelize.query(
      `INSERT INTO t_api_key
        (f_user_id, f_label, f_api_key, f_api_secret_hash, f_permissions, f_ip_whitelist, f_symbol_whitelist)
       VALUES (:userId, :label, :apiKey, :hash, :permissions, :ipWhitelist, :symbolWhitelist)`,
      {
        replacements: {
          userId,
          label: label || "Default",
          apiKey,
          hash: encryptApiSecret(apiSecret),
          permissions,
          ipWhitelist,
          symbolWhitelist,
        },
      },
    );

    return { apiKey, apiSecret, label, permissions, ipWhitelist, symbolWhitelist };
  }

  static async list(userId: number) {
    const sequelize = await getSequelize();
    if (!sequelize) return [];
    return sequelize.query(
      `SELECT f_id AS id, f_label AS label, f_api_key AS apiKey, f_permissions AS permissions,
              f_ip_whitelist AS ipWhitelist, f_symbol_whitelist AS symbolWhitelist,
              f_status AS status, UNIX_TIMESTAMP(f_last_used_at)*1000 AS lastUsedAt,
              UNIX_TIMESTAMP(f_create_time)*1000 AS createdAt
       FROM t_api_key WHERE f_user_id = :userId ORDER BY f_id DESC`,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
  }

  static async update(
    userId: number,
    apiKey: string,
    input: {
      label?: string;
      permissions?: string;
      ipWhitelist?: string;
      symbolWhitelist?: string;
    },
  ) {
    const sequelize = await getSequelize();
    if (!sequelize) throw new BadRequestError("数据库未启用");

    const fields: string[] = [];
    const replacements: Record<string, unknown> = { userId, apiKey };
    if (input.label !== undefined) {
      fields.push("f_label = :label");
      replacements.label = input.label;
    }
    if (input.permissions !== undefined) {
      fields.push("f_permissions = :permissions");
      replacements.permissions = input.permissions;
    }
    if (input.ipWhitelist !== undefined) {
      fields.push("f_ip_whitelist = :ipWhitelist");
      replacements.ipWhitelist = input.ipWhitelist;
    }
    if (input.symbolWhitelist !== undefined) {
      fields.push("f_symbol_whitelist = :symbolWhitelist");
      replacements.symbolWhitelist = input.symbolWhitelist;
    }
    if (fields.length === 0) throw new BadRequestError("无更新字段");

    const [result] = await sequelize.query(
      `UPDATE t_api_key SET ${fields.join(", ")}
       WHERE f_user_id = :userId AND f_api_key = :apiKey AND f_status = 1`,
      { replacements },
    );
    const affected = (result as { affectedRows?: number })?.affectedRows ?? 0;
    if (!affected) throw new NotFoundError("API Key 不存在");
    return { ok: true };
  }

  static async revoke(userId: number, apiKey: string) {
    const sequelize = await getSequelize();
    if (!sequelize) return;
    await sequelize.query(
      `UPDATE t_api_key SET f_status = 0 WHERE f_user_id = :userId AND f_api_key = :apiKey`,
      { replacements: { userId, apiKey } },
    );
  }

  static async listLogs(userId: number, apiKey: string, limit = 50) {
    const sequelize = await getSequelize();
    if (!sequelize) return [];
    return sequelize.query(
      `SELECT f_method AS method, f_path AS path, f_status_code AS statusCode,
              f_ip AS ip, UNIX_TIMESTAMP(f_create_time)*1000 AS ts
       FROM t_api_key_call_log
       WHERE f_user_id = :userId AND f_api_key = :apiKey
       ORDER BY f_id DESC LIMIT :limit`,
      { replacements: { userId, apiKey, limit }, type: QueryTypes.SELECT },
    );
  }

  static async logCall(input: {
    userId: number;
    apiKey: string;
    method: string;
    path: string;
    statusCode: number;
    ip: string;
  }) {
    const sequelize = await getSequelize();
    if (!sequelize) return;
    await sequelize.query(
      `INSERT INTO t_api_key_call_log
        (f_user_id, f_api_key, f_method, f_path, f_status_code, f_ip)
       VALUES (:userId, :apiKey, :method, :path, :statusCode, :ip)`,
      {
        replacements: {
          ...input,
          method: input.method.slice(0, 16),
          path: input.path.slice(0, 255),
          ip: input.ip.slice(0, 64),
        },
      },
    );
    await sequelize.query(
      `UPDATE t_api_key SET f_last_used_at = NOW() WHERE f_api_key = :apiKey`,
      { replacements: { apiKey: input.apiKey } },
    );
  }
}

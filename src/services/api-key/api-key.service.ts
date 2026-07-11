import crypto from "crypto";
import { QueryTypes } from "sequelize";
import { getSequelize } from "@/db/connection";
import { BadRequestError } from "@/errors/app-error";
import { encryptApiSecret } from "@/utils/api-key-crypto";

export class ApiKeyService {
  static async create(userId: number, label: string, permissions = "read,trade") {
    const sequelize = await getSequelize();
    if (!sequelize) throw new BadRequestError("数据库未启用");

    const apiKey = `vk_${crypto.randomBytes(16).toString("hex")}`;
    const apiSecret = crypto.randomBytes(32).toString("hex");

    await sequelize.query(
      `INSERT INTO t_api_key (f_user_id, f_label, f_api_key, f_api_secret_hash, f_permissions)
       VALUES (:userId, :label, :apiKey, :hash, :permissions)`,
      {
        replacements: {
          userId,
          label: label || "Default",
          apiKey,
          hash: encryptApiSecret(apiSecret),
          permissions,
        },
      },
    );

    return { apiKey, apiSecret, label, permissions };
  }

  static async list(userId: number) {
    const sequelize = await getSequelize();
    if (!sequelize) return [];
    return sequelize.query(
      `SELECT f_id AS id, f_label AS label, f_api_key AS apiKey, f_permissions AS permissions,
              f_status AS status, UNIX_TIMESTAMP(f_create_time)*1000 AS createdAt
       FROM t_api_key WHERE f_user_id = :userId ORDER BY f_id DESC`,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
  }

  static async revoke(userId: number, apiKey: string) {
    const sequelize = await getSequelize();
    if (!sequelize) return;
    await sequelize.query(
      `UPDATE t_api_key SET f_status = 0 WHERE f_user_id = :userId AND f_api_key = :apiKey`,
      { replacements: { userId, apiKey } },
    );
  }
}

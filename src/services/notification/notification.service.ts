import { QueryTypes } from "sequelize";
import { getSequelize } from "@/db/connection";

export interface NotificationInput {
  type: "trade" | "deposit" | "withdraw" | "system" | "risk";
  title: string;
  body?: string;
  refId?: string;
}

export class NotificationService {
  static async create(userId: number, input: NotificationInput) {
    const sequelize = await getSequelize();
    if (!sequelize) return;

    await sequelize.query(
      `INSERT INTO t_user_notification (f_user_id, f_type, f_title, f_body, f_ref_id)
       VALUES (:userId, :type, :title, :body, :refId)`,
      {
        replacements: {
          userId,
          type: input.type,
          title: input.title,
          body: input.body ?? "",
          refId: input.refId ?? "",
        },
      },
    );
  }

  static async list(userId: number, page = 1, pageSize = 30) {
    const sequelize = await getSequelize();
    if (!sequelize) return { rows: [], total: 0, unread: 0 };

    const offset = (page - 1) * pageSize;
    const rows = await sequelize.query(
      `SELECT f_id AS id, f_type AS type, f_title AS title, f_body AS body,
              f_ref_id AS refId, f_read AS read,
              UNIX_TIMESTAMP(f_create_time)*1000 AS ts
       FROM t_user_notification WHERE f_user_id = :userId
       ORDER BY f_id DESC LIMIT :limit OFFSET :offset`,
      { replacements: { userId, limit: pageSize, offset }, type: QueryTypes.SELECT },
    );
    const counts = await sequelize.query<{ total: number; unread: number }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN f_read = 0 THEN 1 ELSE 0 END) AS unread
       FROM t_user_notification WHERE f_user_id = :userId`,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
    return {
      rows,
      total: counts[0]?.total ?? 0,
      unread: Number(counts[0]?.unread ?? 0),
      page,
      pageSize,
    };
  }

  static async markRead(userId: number, ids: number[]) {
    if (ids.length === 0) return;
    const sequelize = await getSequelize();
    if (!sequelize) return;
    await sequelize.query(
      `UPDATE t_user_notification SET f_read = 1
       WHERE f_user_id = :userId AND f_id IN (:ids)`,
      { replacements: { userId, ids } },
    );
  }
}

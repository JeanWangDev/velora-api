import { QueryTypes } from "sequelize";
import { getSequelize } from "@/db/connection";
import { BadRequestError, NotFoundError } from "@/errors/app-error";

export type AnnouncementCategory = "listing" | "maintenance" | "risk" | "system";

export interface AnnouncementRow {
  id: number;
  category: AnnouncementCategory;
  titleZh: string;
  titleEn: string;
  summaryZh: string;
  summaryEn: string;
  contentZh: string;
  contentEn: string;
  pinned: number;
  status: number;
  publishedAt: number;
}

function mapRow(r: Record<string, unknown>): AnnouncementRow {
  return {
    id: Number(r.id),
    category: String(r.category) as AnnouncementCategory,
    titleZh: String(r.titleZh),
    titleEn: String(r.titleEn),
    summaryZh: String(r.summaryZh ?? ""),
    summaryEn: String(r.summaryEn ?? ""),
    contentZh: String(r.contentZh ?? ""),
    contentEn: String(r.contentEn ?? ""),
    pinned: Number(r.pinned ?? 0),
    status: Number(r.status ?? 1),
    publishedAt: Number(r.publishedAt),
  };
}

export class AnnouncementService {
  static async listPublic(category?: string, page = 1, pageSize = 50) {
    const sequelize = await getSequelize();
    if (!sequelize) return { rows: [], total: 0 };

    const offset = (page - 1) * pageSize;
    const where = category && category !== "all"
      ? "f_status = 1 AND f_category = :category"
      : "f_status = 1";
    const replacements: Record<string, unknown> = { limit: pageSize, offset };
    if (category && category !== "all") replacements.category = category;

    const rows = await sequelize.query(
      `SELECT f_id AS id, f_category AS category,
              f_title_zh AS titleZh, f_title_en AS titleEn,
              f_summary_zh AS summaryZh, f_summary_en AS summaryEn,
              f_content_zh AS contentZh, f_content_en AS contentEn,
              f_pinned AS pinned, f_status AS status,
              UNIX_TIMESTAMP(f_publish_time)*1000 AS publishedAt
       FROM t_announcement WHERE ${where}
       ORDER BY f_pinned DESC, f_publish_time DESC
       LIMIT :limit OFFSET :offset`,
      { replacements, type: QueryTypes.SELECT },
    );
    const counts = await sequelize.query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM t_announcement WHERE ${where}`,
      { replacements, type: QueryTypes.SELECT },
    );
    return {
      rows: (rows as Record<string, unknown>[]).map(mapRow),
      total: counts[0]?.total ?? 0,
      page,
      pageSize,
    };
  }

  static async getPublic(id: number) {
    const sequelize = await getSequelize();
    if (!sequelize) throw new NotFoundError("公告不存在");

    const rows = await sequelize.query(
      `SELECT f_id AS id, f_category AS category,
              f_title_zh AS titleZh, f_title_en AS titleEn,
              f_summary_zh AS summaryZh, f_summary_en AS summaryEn,
              f_content_zh AS contentZh, f_content_en AS contentEn,
              f_pinned AS pinned, f_status AS status,
              UNIX_TIMESTAMP(f_publish_time)*1000 AS publishedAt
       FROM t_announcement WHERE f_id = :id AND f_status = 1 LIMIT 1`,
      { replacements: { id }, type: QueryTypes.SELECT },
    );
    const row = (rows as Record<string, unknown>[])[0];
    if (!row) throw new NotFoundError("公告不存在");
    return mapRow(row);
  }

  static async adminList(page = 1, pageSize = 50) {
    const sequelize = await getSequelize();
    if (!sequelize) return { rows: [], total: 0 };
    const offset = (page - 1) * pageSize;
    const rows = await sequelize.query(
      `SELECT f_id AS id, f_category AS category,
              f_title_zh AS titleZh, f_title_en AS titleEn,
              f_summary_zh AS summaryZh, f_summary_en AS summaryEn,
              f_content_zh AS contentZh, f_content_en AS contentEn,
              f_pinned AS pinned, f_status AS status,
              UNIX_TIMESTAMP(f_publish_time)*1000 AS publishedAt
       FROM t_announcement
       ORDER BY f_id DESC LIMIT :limit OFFSET :offset`,
      { replacements: { limit: pageSize, offset }, type: QueryTypes.SELECT },
    );
    const counts = await sequelize.query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM t_announcement`,
      { type: QueryTypes.SELECT },
    );
    return {
      rows: (rows as Record<string, unknown>[]).map(mapRow),
      total: counts[0]?.total ?? 0,
      page,
      pageSize,
    };
  }

  static async adminCreate(input: {
    category: AnnouncementCategory;
    titleZh: string;
    titleEn: string;
    summaryZh?: string;
    summaryEn?: string;
    contentZh: string;
    contentEn: string;
    pinned?: boolean;
    status?: number;
  }) {
    const sequelize = await getSequelize();
    if (!sequelize) throw new BadRequestError("数据库未启用");

    await sequelize.query(
      `INSERT INTO t_announcement (
        f_category, f_title_zh, f_title_en, f_summary_zh, f_summary_en,
        f_content_zh, f_content_en, f_pinned, f_status
      ) VALUES (
        :category, :titleZh, :titleEn, :summaryZh, :summaryEn,
        :contentZh, :contentEn, :pinned, :status
      )`,
      {
        replacements: {
          category: input.category,
          titleZh: input.titleZh,
          titleEn: input.titleEn,
          summaryZh: input.summaryZh ?? "",
          summaryEn: input.summaryEn ?? "",
          contentZh: input.contentZh,
          contentEn: input.contentEn,
          pinned: input.pinned ? 1 : 0,
          status: input.status ?? 1,
        },
      },
    );
    return { ok: true };
  }

  static async adminUpdate(input: {
    id: number;
    category?: AnnouncementCategory;
    titleZh?: string;
    titleEn?: string;
    summaryZh?: string;
    summaryEn?: string;
    contentZh?: string;
    contentEn?: string;
    pinned?: boolean;
    status?: number;
  }) {
    const sequelize = await getSequelize();
    if (!sequelize) throw new BadRequestError("数据库未启用");

    const fields: string[] = [];
    const replacements: Record<string, unknown> = { id: input.id };
    const set = (col: string, key: string, val: unknown) => {
      fields.push(`${col} = :${key}`);
      replacements[key] = val;
    };

    if (input.category) set("f_category", "category", input.category);
    if (input.titleZh) set("f_title_zh", "titleZh", input.titleZh);
    if (input.titleEn) set("f_title_en", "titleEn", input.titleEn);
    if (input.summaryZh !== undefined) set("f_summary_zh", "summaryZh", input.summaryZh);
    if (input.summaryEn !== undefined) set("f_summary_en", "summaryEn", input.summaryEn);
    if (input.contentZh) set("f_content_zh", "contentZh", input.contentZh);
    if (input.contentEn) set("f_content_en", "contentEn", input.contentEn);
    if (input.pinned !== undefined) set("f_pinned", "pinned", input.pinned ? 1 : 0);
    if (input.status !== undefined) set("f_status", "status", input.status);

    if (fields.length === 0) throw new BadRequestError("无更新字段");

    await sequelize.query(
      `UPDATE t_announcement SET ${fields.join(", ")} WHERE f_id = :id`,
      { replacements },
    );
    return { ok: true };
  }

  static async adminRemove(id: number) {
    const sequelize = await getSequelize();
    if (!sequelize) throw new BadRequestError("数据库未启用");
    await sequelize.query(`DELETE FROM t_announcement WHERE f_id = :id`, {
      replacements: { id },
    });
    return { ok: true };
  }
}

import { QueryTypes } from "sequelize";
import { getSequelize } from "@/db/connection";
import { BadRequestError, NotFoundError } from "@/errors/app-error";

function genNo() {
  return `TK${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

export class SupportTicketService {
  static async create(userId: number, input: {
    category?: string;
    subject: string;
    body: string;
  }) {
    const sequelize = await getSequelize();
    if (!sequelize) throw new BadRequestError("数据库未启用");
    if (!input.subject.trim() || !input.body.trim()) {
      throw new BadRequestError("主题和内容不能为空");
    }

    const ticketNo = genNo();
    await sequelize.query(
      `INSERT INTO t_support_ticket (f_ticket_no, f_user_id, f_category, f_subject, f_body)
       VALUES (:ticketNo, :userId, :category, :subject, :body)`,
      {
        replacements: {
          ticketNo,
          userId,
          category: input.category ?? "general",
          subject: input.subject.slice(0, 255),
          body: input.body,
        },
      },
    );
    return { ticketNo, status: "open" as const };
  }

  static async listForUser(userId: number) {
    const sequelize = await getSequelize();
    if (!sequelize) return [];
    return sequelize.query(
      `SELECT f_ticket_no AS ticketNo, f_category AS category, f_subject AS subject,
              f_body AS body, f_status AS status, f_admin_reply AS adminReply,
              UNIX_TIMESTAMP(f_create_time)*1000 AS createdAt
       FROM t_support_ticket WHERE f_user_id = :userId
       ORDER BY f_id DESC LIMIT 100`,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
  }

  static async getForUser(userId: number, ticketNo: string) {
    const sequelize = await getSequelize();
    if (!sequelize) throw new NotFoundError("工单不存在");
    const rows = await sequelize.query(
      `SELECT f_ticket_no AS ticketNo, f_category AS category, f_subject AS subject,
              f_body AS body, f_status AS status, f_admin_reply AS adminReply,
              UNIX_TIMESTAMP(f_create_time)*1000 AS createdAt
       FROM t_support_ticket
       WHERE f_user_id = :userId AND f_ticket_no = :ticketNo LIMIT 1`,
      { replacements: { userId, ticketNo }, type: QueryTypes.SELECT },
    );
    const row = (rows as Record<string, unknown>[])[0];
    if (!row) throw new NotFoundError("工单不存在");
    return row;
  }

  static async adminList(page = 1, pageSize = 50) {
    const sequelize = await getSequelize();
    if (!sequelize) return { rows: [], total: 0 };
    const offset = (page - 1) * pageSize;
    const rows = await sequelize.query(
      `SELECT f_ticket_no AS ticketNo, f_user_id AS userId, f_category AS category,
              f_subject AS subject, f_status AS status,
              UNIX_TIMESTAMP(f_create_time)*1000 AS createdAt
       FROM t_support_ticket ORDER BY f_id DESC LIMIT :limit OFFSET :offset`,
      { replacements: { limit: pageSize, offset }, type: QueryTypes.SELECT },
    );
    const total = await sequelize.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM t_support_ticket`,
      { type: QueryTypes.SELECT },
    );
    return { rows, total: total[0]?.cnt ?? 0, page, pageSize };
  }

  static async adminReply(ticketNo: string, reply: string, close = false) {
    const sequelize = await getSequelize();
    if (!sequelize) throw new BadRequestError("数据库未启用");
    await sequelize.query(
      `UPDATE t_support_ticket
       SET f_admin_reply = :reply, f_status = :status
       WHERE f_ticket_no = :ticketNo`,
      {
        replacements: {
          ticketNo,
          reply,
          status: close ? "closed" : "replied",
        },
      },
    );
    return { ok: true };
  }
}

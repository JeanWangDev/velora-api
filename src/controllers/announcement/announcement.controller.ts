import type { Context } from "koa";
import { AnnouncementService } from "@/services/platform/announcement.service";

export class AnnouncementController {
  static async list(ctx: Context) {
    const category = (ctx.query.category as string | undefined) ?? "all";
    const page = Number(ctx.query.page ?? 1);
    const pageSize = Number(ctx.query.pageSize ?? 50);
    const data = await AnnouncementService.listPublic(category, page, pageSize);
    ctx.sendSuccess(data);
  }

  static async getById(ctx: Context) {
    const id = Number(ctx.params.id);
    const row = await AnnouncementService.getPublic(id);
    ctx.sendSuccess(row);
  }
}

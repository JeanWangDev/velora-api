import type { Context } from "koa";
import { BadRequestError } from "@/errors/app-error";
import { requireAuthUser } from "@/middlewares/auth.middleware";
import { AnnouncementService } from "@/services/platform/announcement.service";
import { z } from "zod";

const createSchema = z.object({
  category: z.enum(["listing", "maintenance", "risk", "system"]),
  titleZh: z.string().min(1),
  titleEn: z.string().min(1),
  summaryZh: z.string().optional(),
  summaryEn: z.string().optional(),
  contentZh: z.string().min(1),
  contentEn: z.string().min(1),
  pinned: z.boolean().optional(),
  status: z.number().optional(),
});

const updateSchema = createSchema.partial().extend({ id: z.number() });

export class AdminAnnouncementController {
  static async list(ctx: Context) {
    requireAuthUser(ctx);
    const page = Number(ctx.query.page ?? 1);
    const pageSize = Number(ctx.query.pageSize ?? 50);
    const data = await AnnouncementService.adminList(page, pageSize);
    ctx.sendSuccess(data);
  }

  static async create(ctx: Context) {
    requireAuthUser(ctx);
    const parsed = createSchema.safeParse(ctx.request.body);
    if (!parsed.success) throw new BadRequestError(parsed.error.message);
    const result = await AnnouncementService.adminCreate(parsed.data);
    ctx.sendSuccess(result);
  }

  static async update(ctx: Context) {
    requireAuthUser(ctx);
    const parsed = updateSchema.safeParse(ctx.request.body);
    if (!parsed.success) throw new BadRequestError(parsed.error.message);
    const result = await AnnouncementService.adminUpdate(parsed.data);
    ctx.sendSuccess(result);
  }

  static async remove(ctx: Context) {
    requireAuthUser(ctx);
    const id = Number((ctx.request.body as { id?: number })?.id);
    if (!Number.isFinite(id)) throw new BadRequestError("缺少 id");
    const result = await AnnouncementService.adminRemove(id);
    ctx.sendSuccess(result);
  }
}

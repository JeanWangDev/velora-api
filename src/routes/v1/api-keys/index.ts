import Router from "@koa/router";
import type { Context } from "koa";
import { z } from "zod";
import { BadRequestError } from "@/errors/app-error";
import { requireAuthUser } from "@/middlewares/auth.middleware";
import { ApiKeyService } from "@/services/api-key/api-key.service";

function resolveUserId(ctx: Context): number {
  const authUser = requireAuthUser(ctx);
  return Number(authUser.id);
}

export class ApiKeyController {
  static async list(ctx: Context) {
    const data = await ApiKeyService.list(resolveUserId(ctx));
    ctx.sendSuccess({ data });
  }

  static async create(ctx: Context) {
    const schema = z.object({
      label: z.string().optional(),
      permissions: z.string().optional(),
      ipWhitelist: z.string().optional(),
      symbolWhitelist: z.string().optional(),
    });
    const parsed = schema.safeParse(ctx.request.body);
    if (!parsed.success) throw new BadRequestError("参数无效");
    const data = await ApiKeyService.create(
      resolveUserId(ctx),
      parsed.data.label ?? "",
      parsed.data.permissions,
      parsed.data.ipWhitelist ?? "",
      parsed.data.symbolWhitelist ?? "",
    );
    ctx.sendSuccess(data, { message: "API Key 已创建，请妥善保存 Secret" });
  }

  static async update(ctx: Context) {
    const schema = z.object({
      apiKey: z.string().min(1),
      label: z.string().optional(),
      permissions: z.string().optional(),
      ipWhitelist: z.string().optional(),
      symbolWhitelist: z.string().optional(),
    });
    const parsed = schema.safeParse(ctx.request.body);
    if (!parsed.success) throw new BadRequestError("参数无效");
    const { apiKey, ...rest } = parsed.data;
    const data = await ApiKeyService.update(resolveUserId(ctx), apiKey, rest);
    ctx.sendSuccess(data);
  }

  static async revoke(ctx: Context) {
    const schema = z.object({ apiKey: z.string().min(1) });
    const parsed = schema.safeParse(ctx.request.body);
    if (!parsed.success) throw new BadRequestError("参数无效");
    await ApiKeyService.revoke(resolveUserId(ctx), parsed.data.apiKey);
    ctx.sendSuccess({ ok: true });
  }

  static async logs(ctx: Context) {
    const apiKey = String(ctx.query.apiKey ?? "");
    if (!apiKey) throw new BadRequestError("apiKey is required");
    const data = await ApiKeyService.listLogs(resolveUserId(ctx), apiKey);
    ctx.sendSuccess({ data });
  }
}

const router = new Router({ prefix: "/api-keys" });
router.get("/", ApiKeyController.list);
router.post("/", ApiKeyController.create);
router.post("/update", ApiKeyController.update);
router.post("/revoke", ApiKeyController.revoke);
router.get("/logs", ApiKeyController.logs);

export default router;

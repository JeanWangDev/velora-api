import { createReadStream, promises as fs } from "fs";
import path from "path";
import type { Context, Next } from "koa";
import { UPLOAD_ROOT } from "@/services/kyc";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/** 提供 /uploads/* 静态文件访问（放在鉴权中间件之前，公开可读） */
export async function uploadsMiddleware(ctx: Context, next: Next) {
  if (!ctx.path.startsWith("/uploads/") || ctx.method !== "GET") {
    await next();
    return;
  }

  const relative = decodeURIComponent(ctx.path.replace(/^\/uploads\//, ""));
  const target = path.resolve(UPLOAD_ROOT, relative);

  // 防目录穿越：目标必须仍在 UPLOAD_ROOT 内
  if (target !== UPLOAD_ROOT && !target.startsWith(UPLOAD_ROOT + path.sep)) {
    ctx.status = 403;
    ctx.body = "Forbidden";
    return;
  }

  try {
    const stat = await fs.stat(target);
    if (!stat.isFile()) {
      ctx.status = 404;
      ctx.body = "Not Found";
      return;
    }
    ctx.set("Content-Type", CONTENT_TYPES[path.extname(target).toLowerCase()] ?? "application/octet-stream");
    ctx.set("Cache-Control", "private, max-age=3600");
    ctx.body = createReadStream(target);
  } catch {
    ctx.status = 404;
    ctx.body = "Not Found";
  }
}

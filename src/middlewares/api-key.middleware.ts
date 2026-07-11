import crypto from "crypto";
import type { Context, Next } from "koa";
import { QueryTypes } from "sequelize";
import { getSequelize } from "@/db/connection";
import { UnauthorizedError } from "@/errors/app-error";
import { decryptApiSecret, signApiPayload } from "@/utils/api-key-crypto";

const API_KEY_HEADER = "x-api-key";
const API_SIGN_HEADER = "x-api-sign";
const API_TIMESTAMP_HEADER = "x-api-timestamp";
const MAX_TIMESTAMP_DRIFT_MS = 30_000;

function buildSignPayload(ctx: Context, timestamp: string): string {
  const method = ctx.method.toUpperCase();
  const path = ctx.path;
  const body =
    (ctx.request as { rawBody?: string }).rawBody ??
    (ctx.request.body ? JSON.stringify(ctx.request.body) : "");
  return `${timestamp}${method}${path}${body}`;
}

/** OKX 风格 API Key HMAC-SHA256 鉴权 */
export async function apiKeyAuthMiddleware(ctx: Context, next: Next) {
  const apiKey = ctx.get(API_KEY_HEADER);
  const sign = ctx.get(API_SIGN_HEADER);
  const timestamp = ctx.get(API_TIMESTAMP_HEADER);

  if (!apiKey || !sign || !timestamp) {
    return next();
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_TIMESTAMP_DRIFT_MS) {
    throw new UnauthorizedError("API 时间戳无效或已过期");
  }

  const sequelize = await getSequelize();
  if (!sequelize) throw new UnauthorizedError("服务不可用");

  const rows = await sequelize.query<{
    userId: number;
    secretEnc: string;
    permissions: string;
    ipWhitelist: string;
    status: number;
  }>(
    `SELECT f_user_id AS userId, f_api_secret_hash AS secretEnc, f_permissions AS permissions,
            f_ip_whitelist AS ipWhitelist, f_status AS status
     FROM t_api_key WHERE f_api_key = :apiKey LIMIT 1`,
    { replacements: { apiKey }, type: QueryTypes.SELECT },
  );

  const row = rows[0];
  if (!row || row.status !== 1) {
    throw new UnauthorizedError("API Key 无效或已吊销");
  }

  if (row.ipWhitelist) {
    const clientIp = ctx.ip || "";
    const allowed = row.ipWhitelist.split(",").map((s) => s.trim()).filter(Boolean);
    if (allowed.length > 0 && !allowed.includes(clientIp)) {
      throw new UnauthorizedError("IP 不在白名单");
    }
  }

  let secret: string;
  try {
    secret = decryptApiSecret(row.secretEnc);
  } catch {
    throw new UnauthorizedError("API Key 配置异常");
  }

  const payload = buildSignPayload(ctx, timestamp);
  const expected = signApiPayload(secret, payload);

  if (expected.length !== sign.length) {
    throw new UnauthorizedError("签名无效");
  }

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sign, "utf8");
  if (!crypto.timingSafeEqual(a, b)) {
    throw new UnauthorizedError("签名无效");
  }

  ctx.state.authUser = {
    id: String(row.userId),
    email: "",
    roleKey: "api_user",
    roleLevel: 0,
    authMethod: "api_key",
    permissions: row.permissions.split(",").map((s) => s.trim()),
  };

  await sequelize.query(`UPDATE t_api_key SET f_last_used_at = NOW() WHERE f_api_key = :apiKey`, {
    replacements: { apiKey },
  });

  return next();
}

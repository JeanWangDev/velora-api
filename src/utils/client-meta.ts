import type { Context } from "koa";

export function clientIp(ctx: Context): string {
  const forwarded = ctx.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? "";
  }
  return ctx.ip || "";
}

export function maskIp(ip: string): string {
  if (!ip) return "—";
  if (ip.includes(":")) {
    const parts = ip.split(":");
    return `${parts[0]}:****:${parts[parts.length - 1]}`;
  }
  const segs = ip.split(".");
  if (segs.length === 4) {
    return `${segs[0]}.**.**.${segs[3]}`;
  }
  return ip.slice(0, 3) + "****";
}

export function deviceLabelFromUa(ua: string): string {
  const value = ua || "Unknown";
  if (/iPhone|iPad|iOS/i.test(value)) return "Safari · iOS";
  if (/Android/i.test(value)) return "Chrome · Android";
  if (/Edg\//i.test(value)) return "Edge";
  if (/Chrome/i.test(value) && /Mac/i.test(value)) return "Chrome · macOS";
  if (/Chrome/i.test(value) && /Windows/i.test(value)) return "Chrome · Windows";
  if (/Firefox/i.test(value)) return "Firefox";
  if (/Safari/i.test(value)) return "Safari";
  if (/Velora/i.test(value)) return "Velora App";
  return value.slice(0, 48);
}

export function loginMetaFromCtx(ctx: Context) {
  const ua = ctx.get("user-agent") || "";
  return {
    ip: clientIp(ctx),
    userAgent: ua,
    deviceLabel: deviceLabelFromUa(ua),
  };
}

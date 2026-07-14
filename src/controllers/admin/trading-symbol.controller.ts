import type { Context } from "koa";
import { toTradingPairDto } from "@/dto/market";
import { BadRequestError } from "@/errors/app-error";
import { requireAdmin } from "@/middlewares/require-admin.middleware";
import { TradingSymbolService } from "@/services/market";
import { SpotSymbolSyncService } from "@/services/spot";
import { formatZodError } from "@/validators/common/parse";
import {
  createTradingSymbolBodySchema,
  removeTradingSymbolBodySchema,
  updateTradingSymbolBodySchema,
} from "@/validators/admin";

export class AdminTradingSymbolController {
  static async list(ctx: Context) {
    requireAdmin(ctx);
    const rows = await TradingSymbolService.listAllAdmin();
    ctx.sendSuccess({ data: rows.map(toTradingPairDto) });
  }

  static async create(ctx: Context) {
    requireAdmin(ctx);
    const parsed = createTradingSymbolBodySchema.safeParse(ctx.request.body);
    if (!parsed.success) {
      throw new BadRequestError(formatZodError(parsed.error));
    }

    const created = await TradingSymbolService.create(parsed.data);
    ctx.sendSuccess(toTradingPairDto(created), { message: "交易对已创建" });
  }

  static async update(ctx: Context) {
    requireAdmin(ctx);
    const parsed = updateTradingSymbolBodySchema.safeParse(ctx.request.body);
    if (!parsed.success) {
      throw new BadRequestError(formatZodError(parsed.error));
    }

    const { id, ...input } = parsed.data;
    const updated = await TradingSymbolService.update(id, input);
    ctx.sendSuccess(toTradingPairDto(updated), { message: "交易对已更新" });
  }

  static async remove(ctx: Context) {
    requireAdmin(ctx);
    const parsed = removeTradingSymbolBodySchema.safeParse(ctx.request.body);
    if (!parsed.success) {
      throw new BadRequestError(formatZodError(parsed.error));
    }

    await TradingSymbolService.remove(parsed.data.id);
    ctx.sendSuccess(null, { message: "交易对已下架" });
  }

  /** 从 Binance 全量同步已上架交易对 → 现货元数据（精度/minQty） */
  static async syncSpotFromBinance(ctx: Context) {
    requireAdmin(ctx);
    const result = await SpotSymbolSyncService.syncAllActive();
    ctx.sendSuccess(result, {
      message: `已同步 ${result.synced} 个现货交易对`,
    });
  }
}

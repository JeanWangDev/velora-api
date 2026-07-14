import type { Context } from "koa";
import {
  toKlineBarDtoList,
  toSymbolInfoDto,
  toSymbolSummaryDto,
  toTicker24hDto,
  toTradingPairDto,
} from "@/dto/market";
import { BadRequestError } from "@/errors/app-error";
import { MarketBriefService, MarketService, TradingSymbolService } from "@/services/market";
import {
  formatZodError,
  depthQuerySchema,
  klinesQuerySchema,
  marketBriefQuerySchema,
  priceLevelsQuerySchema,
  searchSymbolsQuerySchema,
  tickersQuerySchema,
  symbolInfoQuerySchema,
  tickerQuerySchema,
  tradesQuerySchema,
} from "@/validators/market";

export class MarketController {
  static listExchanges(ctx: Context) {
    ctx.sendSuccess(MarketService.listExchanges());
  }

  static async getServerTime(ctx: Context) {
    const exchange = ctx.query.exchange as string | undefined;
    const data = await MarketService.getServerTime(exchange);
    ctx.sendSuccess(data);
  }

  static async getKlines(ctx: Context) {
    const parsed = klinesQuerySchema.safeParse(ctx.query);
    if (!parsed.success) {
      throw new BadRequestError(formatZodError(parsed.error));
    }

    const { bars, cacheControl } = await MarketService.getKlines(parsed.data);
    ctx.set("Cache-Control", cacheControl);
    ctx.sendSuccess(toKlineBarDtoList(bars));
  }

  static async searchSymbols(ctx: Context) {
    const parsed = searchSymbolsQuerySchema.safeParse(ctx.query);

    if (!parsed.success) {
      throw new BadRequestError(formatZodError(parsed.error));
    }

    const symbols = await MarketService.searchSymbols(parsed.data);

    ctx.set("Cache-Control", "public, max-age=300");
    ctx.sendSuccess(symbols.map(toSymbolSummaryDto));
  }

  static async getTickers24h(ctx: Context) {
    const parsed = tickersQuerySchema.safeParse(ctx.query);
    if (!parsed.success) {
      throw new BadRequestError(formatZodError(parsed.error));
    }

    const tickers = await MarketService.getTickers24h(parsed.data);
    ctx.set("Cache-Control", "public, max-age=2, s-maxage=2");
    ctx.sendSuccess(tickers.map(toTicker24hDto));
  }

  static async listTradingPairs(ctx: Context) {
    const pairs = await TradingSymbolService.listActivePublic();
    ctx.set("Cache-Control", "public, max-age=60");
    ctx.sendSuccess(pairs.map(toTradingPairDto));
  }

  static async getSymbolInfo(ctx: Context) {
    const parsed = symbolInfoQuerySchema.safeParse(ctx.query);

    if (!parsed.success) {
      throw new BadRequestError(formatZodError(parsed.error));
    }

    const info = await MarketService.getSymbolInfo(parsed.data);
    ctx.sendSuccess(toSymbolInfoDto(info));
  }

  static async getTicker24h(ctx: Context) {
    const parsed = tickerQuerySchema.safeParse(ctx.query);

    if (!parsed.success) {
      throw new BadRequestError(formatZodError(parsed.error));
    }

    const ticker = await MarketService.getTicker24h(parsed.data);
    ctx.set("Cache-Control", "public, max-age=2, s-maxage=2");
    ctx.sendSuccess(toTicker24hDto(ticker));
  }

  static async getDepth(ctx: Context) {
    const parsed = depthQuerySchema.safeParse(ctx.query);
    if (!parsed.success) {
      throw new BadRequestError(formatZodError(parsed.error));
    }

    const depth = await MarketService.getDepth(parsed.data);
    ctx.set("Cache-Control", "public, max-age=1, s-maxage=1");
    ctx.sendSuccess(depth);
  }

  static async getTrades(ctx: Context) {
    const parsed = tradesQuerySchema.safeParse(ctx.query);
    if (!parsed.success) {
      throw new BadRequestError(formatZodError(parsed.error));
    }

    const trades = await MarketService.getTrades(parsed.data);
    ctx.set("Cache-Control", "public, max-age=1, s-maxage=1");
    ctx.sendSuccess(trades);
  }

  static async getPriceLevels(ctx: Context) {
    const parsed = priceLevelsQuerySchema.safeParse(ctx.query);

    if (!parsed.success) {
      throw new BadRequestError(formatZodError(parsed.error));
    }

    const data = await MarketService.getPriceLevels(parsed.data);
    ctx.set("Cache-Control", "public, max-age=30, s-maxage=30");
    ctx.sendSuccess(data);
  }

  static async getMarketBrief(ctx: Context) {
    const parsed = marketBriefQuerySchema.safeParse(ctx.query);

    if (!parsed.success) {
      throw new BadRequestError(formatZodError(parsed.error));
    }

    const data = await MarketBriefService.getBrief(parsed.data);
    ctx.set("Cache-Control", "public, max-age=60, s-maxage=60");
    ctx.sendSuccess(data);
  }
}

import { z } from "zod";

export const placeSpotOrderBodySchema = z
  .object({
    symbol: z.string().trim().min(3, "无效的交易对").max(32),
    side: z.enum(["buy", "sell"], { message: "无效的买卖方向" }),
    type: z.enum(["limit", "market"], { message: "无效的订单类型" }),
    timeInForce: z.enum(["gtc", "post_only", "ioc", "fok"]).optional().default("gtc"),
    price: z.coerce.number().positive().nullable().optional(),
    quantity: z.coerce.number().positive("下单数量必须大于 0"),
  })
  .refine((v) => v.type !== "limit" || (v.price ?? 0) > 0, {
    message: "限价单必须填写价格",
    path: ["price"],
  })
  .refine((v) => v.type === "limit" || v.timeInForce === "gtc", {
    message: "市价单仅支持 GTC",
    path: ["timeInForce"],
  });

export const cancelSpotOrderBodySchema = z.object({
  orderNo: z.string().trim().min(1, "无效的订单号").max(32),
});

export const spotListQuerySchema = z.object({
  symbol: z.string().trim().max(32).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(50),
});

export type PlaceSpotOrderBody = z.infer<typeof placeSpotOrderBodySchema>;
export type CancelSpotOrderBody = z.infer<typeof cancelSpotOrderBodySchema>;
export type SpotListQuery = z.infer<typeof spotListQuerySchema>;

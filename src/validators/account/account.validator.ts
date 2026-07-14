import { z } from "zod";

export const accountLedgerQuerySchema = z.object({
  currency: z.string().trim().max(16).optional(),
  accountType: z.enum(["funding", "trading", "futures", "earn", "margin"]).optional(),
  type: z
    .enum([
      "deposit",
      "withdraw",
      "trade",
      "fee",
      "freeze",
      "unfreeze",
      "credit",
      "transfer",
    ])
    .optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(50),
});

export type AccountLedgerQuery = z.infer<typeof accountLedgerQuerySchema>;

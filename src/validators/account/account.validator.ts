import { z } from "zod";

export const accountLedgerQuerySchema = z.object({
  currency: z.string().trim().max(16).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(50),
});

export type AccountLedgerQuery = z.infer<typeof accountLedgerQuerySchema>;

import { z } from "zod";

export const adminFinanceCreditBodySchema = z.object({
  userId: z.coerce.number().int().positive("用户 ID 无效"),
  currency: z.string().trim().min(1, "请填写币种").max(16),
  amount: z.coerce.number().positive("充值金额必须大于 0"),
  remark: z.string().trim().max(255).optional(),
});

export const adminFinanceDebitBodySchema = z.object({
  userId: z.coerce.number().int().positive("用户 ID 无效"),
  currency: z.string().trim().min(1, "请填写币种").max(16),
  amount: z.coerce.number().positive("扣减金额必须大于 0"),
  remark: z.string().trim().max(255).optional(),
});

export const adminFinanceListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  targetUserId: z.coerce.number().int().positive().optional(),
  currency: z.string().trim().max(16).optional(),
  type: z.enum(["credit", "debit"]).optional(),
});

export const adminFinanceUserQuerySchema = z.object({
  userId: z.coerce.number().int().positive("用户 ID 无效"),
});

export type AdminFinanceCreditBody = z.infer<typeof adminFinanceCreditBodySchema>;
export type AdminFinanceDebitBody = z.infer<typeof adminFinanceDebitBodySchema>;
export type AdminFinanceListQuery = z.infer<typeof adminFinanceListQuerySchema>;

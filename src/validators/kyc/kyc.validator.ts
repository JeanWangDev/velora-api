import { z } from "zod";

export const submitKycBodySchema = z.object({
  idType: z.enum(["id_card", "passport"], { message: "请选择证件类型" }),
  fullName: z.string().trim().min(1, "请填写姓名").max(128),
  idNumber: z.string().trim().min(1, "请填写证件号码").max(64),
  countryIso: z.string().trim().min(2).max(8).default("CN"),
  address: z.string().trim().max(255).optional(),
  validUntil: z.string().trim().max(32).optional(),
  docFrontName: z.string().trim().max(255).optional(),
  docBackName: z.string().trim().max(255).optional(),
});

export const reviewKycBodySchema = z.object({
  userId: z.coerce.number().int().positive("用户 ID 无效"),
  action: z.enum(["approve", "reject"], { message: "无效的审核动作" }),
  rejectReason: z.string().trim().max(255).optional(),
});

export const uploadKycBodySchema = z.object({
  side: z.enum(["front", "back"], { message: "无效的证件面" }),
  image: z.string().min(1, "缺少图片数据"),
});

export const adminKycListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: z.enum(["pending", "verified", "rejected"]).optional(),
});

export const diditCreateSessionBodySchema = z.object({
  callbackUrl: z.string().url().optional(),
  language: z.string().trim().min(2).max(8).optional(),
});

export const diditSyncBodySchema = z.object({
  sessionId: z.string().uuid("无效的 Didit session ID"),
});

export type DiditCreateSessionBody = z.infer<typeof diditCreateSessionBodySchema>;
export type DiditSyncBody = z.infer<typeof diditSyncBodySchema>;

export type SubmitKycBody = z.infer<typeof submitKycBodySchema>;
export type ReviewKycBody = z.infer<typeof reviewKycBodySchema>;
export type AdminKycListQuery = z.infer<typeof adminKycListQuerySchema>;
export type UploadKycBody = z.infer<typeof uploadKycBodySchema>;

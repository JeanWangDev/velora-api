/**
 * 请求参数校验聚合导出（Zod）
 * - common/parse：validateBody、formatZodError 等通用工具
 * - auth/：注册、登录等 body
 * - market/：行情 query
 */
export {
  formatZodError,
  validateBody,
  validateQuery,
  zodToFieldIssues,
  type ValidationIssue,
} from "./common/parse";

export {
  registerBodySchema,
  loginBodySchema,
  loginVerifyBodySchema,
  sendEmailCodeBodySchema,
  verifyEmailCodeBodySchema,
  forgotPasswordBodySchema,
  resetPasswordBodySchema,
  updateProfileBodySchema,
  type RegisterBody,
  type LoginBody,
  type LoginVerifyBody,
  type SendEmailCodeBody,
  type VerifyEmailCodeBody,
  type ForgotPasswordBody,
  type ResetPasswordBody,
  type UpdateProfileBody,
} from "./auth";

export {
  klinesQuerySchema,
  searchSymbolsQuerySchema,
  symbolInfoQuerySchema,
  type KlinesQuery,
  type SearchSymbolsQuery,
  type SymbolInfoQuery,
} from "./market";

export {
  createBillingOrderBodySchema,
  billingOrderNoParamSchema,
  type CreateBillingOrderBody,
} from "./billing";

export {
  submitKycBodySchema,
  reviewKycBodySchema,
  adminKycListQuerySchema,
  uploadKycBodySchema,
  diditCreateSessionBodySchema,
  diditSyncBodySchema,
  type SubmitKycBody,
  type ReviewKycBody,
  type AdminKycListQuery,
  type UploadKycBody,
  type DiditCreateSessionBody,
  type DiditSyncBody,
} from "./kyc";

export {
  placeSpotOrderBodySchema,
  cancelSpotOrderBodySchema,
  spotListQuerySchema,
  type PlaceSpotOrderBody,
  type CancelSpotOrderBody,
  type SpotListQuery,
} from "./spot";

export {
  accountLedgerQuerySchema,
  type AccountLedgerQuery,
} from "./account";

export {
  adminFinanceCreditBodySchema,
  adminFinanceDebitBodySchema,
  adminFinanceListQuerySchema,
  adminFinanceUserQuerySchema,
  type AdminFinanceCreditBody,
  type AdminFinanceDebitBody,
  type AdminFinanceListQuery,
} from "./admin";

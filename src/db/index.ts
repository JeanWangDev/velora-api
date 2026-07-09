/**
 * 数据库模型入口：按业务域放在 models/auth/，此处统一初始化与导出
 */
import {
  initRoleModel,
  initUserModel,
  initUserPasswordHistoryModel,
  initUserResetTokenModel,
  initUserRoleModel,
  initEmailVerificationModel,
} from "@/db/models/auth";
import { initEventModel } from "@/db/models/events";
import { initTradingSymbolModel } from "@/db/models/market";

import { initChartTemplateModel, initChartTemplateUsageModel } from "@/db/models/chart-template";
import {
  initMembershipPlanModel,
  initPaymentAddressIndexModel,
  initPaymentOrderModel,
  initUserSubscriptionModel,
} from "@/db/models/billing";
import {
  initCopyOrderLogModel,
  initCopySubscriptionModel,
} from "@/db/models/copy";
import {
  initCreatorBalanceModel,
  initCreatorLedgerModel,
  initCreatorWithdrawalModel,
} from "@/db/models/creator";
import { initExchangeConnectionModel } from "@/db/models/exchange/exchange-connection.model";
import { initKycVerificationModel } from "@/db/models/kyc";
import { initAccountBalanceModel, initAccountLedgerModel } from "@/db/models/account";
import {
  initSpotOrderModel,
  initSpotSymbolModel,
  initSpotTradeModel,
} from "@/db/models/spot";
import { initAdminFinanceOpModel } from "@/db/models/admin";
import {
  initStrategyFollowModel,
  initStrategyModel,
  initStrategyPaperStateModel,
  initStrategyPaperTradeModel,
} from "@/db/models/strategy";

/** 启动时注册 Sequelize 模型（需在 initDatabase 之后调用） */
export async function initModels() {
  await initRoleModel();
  await initUserModel();
  await initUserRoleModel();
  await initUserPasswordHistoryModel();
  await initUserResetTokenModel();
  await initEmailVerificationModel();
  await initEventModel();
  await initTradingSymbolModel();
  await initChartTemplateModel();
  await initChartTemplateUsageModel();
  await initMembershipPlanModel();
  await initPaymentAddressIndexModel();
  await initPaymentOrderModel();
  await initUserSubscriptionModel();
  await initStrategyModel();
  await initStrategyFollowModel();
  await initStrategyPaperStateModel();
  await initStrategyPaperTradeModel();
  await initCreatorBalanceModel();
  await initCreatorLedgerModel();
  await initCreatorWithdrawalModel();
  await initExchangeConnectionModel();
  await initCopySubscriptionModel();
  await initCopyOrderLogModel();
  await initKycVerificationModel();
  await initAccountBalanceModel();
  await initAccountLedgerModel();
  await initSpotSymbolModel();
  await initSpotOrderModel();
  await initSpotTradeModel();
  await initAdminFinanceOpModel();
}

export {
  Role,
  User,
  UserPasswordHistory,
  UserResetToken,
  UserRole,
  EmailVerification,
} from "@/db/models/auth";

export { Event } from "@/db/models/events";
export { TradingSymbol } from "@/db/models/market";
export { ChartTemplate, ChartTemplateUsage } from "@/db/models/chart-template";
export {
  MembershipPlan,
  PaymentAddressIndex,
  PaymentOrder,
  UserSubscription,
} from "@/db/models/billing";
export {
  Strategy,
  StrategyFollow,
  StrategyPaperState,
  StrategyPaperTrade,
} from "@/db/models/strategy";
export { CreatorBalance, CreatorLedger, CreatorWithdrawal } from "@/db/models/creator";
export { ExchangeConnection } from "@/db/models/exchange/exchange-connection.model";
export { CopySubscription, CopyOrderLog } from "@/db/models/copy";
export { KycVerification } from "@/db/models/kyc";
export { AccountBalance, AccountLedger, type LedgerType } from "@/db/models/account";
export {
  SpotSymbol,
  SpotOrder,
  SpotTrade,
  type SpotOrderSide,
  type SpotOrderType,
  type SpotOrderStatus,
} from "@/db/models/spot";
export { AdminFinanceOp, type AdminFinanceOpType } from "@/db/models/admin";

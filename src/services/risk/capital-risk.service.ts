import { QueryTypes } from "sequelize";
import { getSequelize } from "@/db/connection";
import { BadRequestError } from "@/errors/app-error";

/**
 * 资金风控（规则引擎，不接外部 AML）：
 * - 日提现 USDT 上限
 * - 新地址冷却期
 */
export class CapitalRiskService {
  static async assertWithdrawAllowed(input: {
    userId: number;
    currency: string;
    amount: number;
    address: string;
  }) {
    const sequelize = await getSequelize();
    if (!sequelize) return;

    const limits = await sequelize.query<{
      dailyUsdtLimit: string;
      cooldownHours: number;
    }>(
      `SELECT f_daily_usdt_limit AS dailyUsdtLimit,
              f_new_address_cooldown_hours AS cooldownHours
       FROM t_user_withdraw_limit WHERE f_user_id = :userId LIMIT 1`,
      { replacements: { userId: input.userId }, type: QueryTypes.SELECT },
    );

    const dailyLimit = Number(limits[0]?.dailyUsdtLimit ?? 50_000);
    const cooldownHours = Number(limits[0]?.cooldownHours ?? 24);

    // 仅对 USDT 及等价稳定币做金额累计
    if (["USDT", "USDC"].includes(input.currency.toUpperCase())) {
      const used = await sequelize.query<{ total: string }>(
        `SELECT COALESCE(SUM(f_amount), 0) AS total
         FROM t_withdrawal_request
         WHERE f_user_id = :userId
           AND f_currency IN ('USDT','USDC')
           AND f_status IN ('pending','approved','completed')
           AND f_create_time >= DATE_SUB(NOW(), INTERVAL 1 DAY)`,
        { replacements: { userId: input.userId }, type: QueryTypes.SELECT },
      );
      const usedAmt = Number(used[0]?.total ?? 0);
      if (usedAmt + input.amount > dailyLimit + 1e-9) {
        throw new BadRequestError(
          `超过日提现限额 ${dailyLimit} USDT（今日已用 ${usedAmt.toFixed(2)}）`,
        );
      }
    }

    const prev = await sequelize.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM t_withdrawal_request
       WHERE f_user_id = :userId AND f_address = :address
         AND f_status IN ('approved','completed')`,
      {
        replacements: { userId: input.userId, address: input.address },
        type: QueryTypes.SELECT,
      },
    );
    const known = Number(prev[0]?.cnt ?? 0) > 0;
    if (!known && cooldownHours > 0) {
      const recent = await sequelize.query<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM t_login_session
         WHERE f_user_id = :userId AND f_success = 1
           AND f_create_time >= DATE_SUB(NOW(), INTERVAL :hours HOUR)`,
        {
          replacements: { userId: input.userId, hours: cooldownHours },
          type: QueryTypes.SELECT,
        },
      );
      // 新地址：要求账户至少有一次成功登录历史（冷却由首次提现后人工审核兜底）
      if (Number(recent[0]?.cnt ?? 0) === 0) {
        throw new BadRequestError("新地址提现需先完成一次安全登录验证");
      }
    }
  }
}

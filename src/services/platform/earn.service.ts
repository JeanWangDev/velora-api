import { QueryTypes } from "sequelize";
import { getSequelize } from "@/db/connection";
import { BadRequestError } from "@/errors/app-error";
import { AccountService, roundAmount } from "@/services/account/account.service";

function genNo(prefix: string) {
  return `${prefix}${Date.now().toString(36)}`.toUpperCase();
}

export class EarnService {
  static async listProducts() {
    const sequelize = await getSequelize();
    if (!sequelize) return [];
    return sequelize.query(
      `SELECT f_product_no AS productNo, f_currency AS currency, f_name AS name,
              f_apr AS apr, f_min_amount AS minAmount
       FROM t_earn_product WHERE f_status = 1 ORDER BY f_id`,
      { type: QueryTypes.SELECT },
    );
  }

  static async listPositions(userId: number) {
    const sequelize = await getSequelize();
    if (!sequelize) return [];
    return sequelize.query(
      `SELECT f_id AS id, f_product_no AS productNo, f_currency AS currency,
              f_principal AS principal, f_accrued AS accrued, f_status AS status,
              UNIX_TIMESTAMP(f_create_time)*1000 AS ts
       FROM t_earn_position WHERE f_user_id = :userId AND f_status = 'active'
       ORDER BY f_id DESC`,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
  }

  static async subscribe(userId: number, productNo: string, amount: number) {
    const sequelize = await getSequelize();
    if (!sequelize) throw new BadRequestError("数据库未启用");
    const amt = roundAmount(amount);
    if (!(amt > 0)) throw new BadRequestError("申购金额无效");

    const products = await sequelize.query<{ currency: string; minAmount: string; apr: string }>(
      `SELECT f_currency AS currency, f_min_amount AS minAmount, f_apr AS apr
       FROM t_earn_product WHERE f_product_no = :productNo AND f_status = 1 LIMIT 1`,
      { replacements: { productNo }, type: QueryTypes.SELECT },
    );
    const product = products[0];
    if (!product) throw new BadRequestError("产品不存在");
    if (amt < Number(product.minAmount)) {
      throw new BadRequestError(`低于最小申购 ${product.minAmount}`);
    }

    await AccountService.runInTransaction(async (tx) => {
      const avail = await AccountService.getAvailable(userId, product.currency, tx, "funding");
      if (avail < amt) throw new BadRequestError("资金账户余额不足");
      await AccountService.adjust(
        {
          userId,
          currency: product.currency,
          accountType: "funding",
          availableDelta: -amt,
          ledgerType: "transfer",
          ledgerAmount: -amt,
          refId: genNo("ES"),
        },
        tx,
      );
      await AccountService.adjust(
        {
          userId,
          currency: product.currency,
          accountType: "earn",
          availableDelta: amt,
          ledgerType: "transfer",
          ledgerAmount: amt,
          refId: genNo("ES"),
        },
        tx,
      );
      await sequelize.query(
        `INSERT INTO t_earn_position (f_user_id, f_product_no, f_currency, f_principal)
         VALUES (:userId, :productNo, :currency, :amount)`,
        {
          replacements: { userId, productNo, currency: product.currency, amount: amt },
          transaction: tx,
        },
      );
    });
    return { ok: true };
  }

  static async redeem(userId: number, positionId: number) {
    const sequelize = await getSequelize();
    if (!sequelize) throw new BadRequestError("数据库未启用");

    const rows = await sequelize.query<{
      id: number;
      currency: string;
      principal: string;
      accrued: string;
    }>(
      `SELECT f_id AS id, f_currency AS currency, f_principal AS principal, f_accrued AS accrued
       FROM t_earn_position WHERE f_id = :id AND f_user_id = :userId AND f_status = 'active' LIMIT 1`,
      { replacements: { id: positionId, userId }, type: QueryTypes.SELECT },
    );
    const pos = rows[0];
    if (!pos) throw new BadRequestError("持仓不存在");
    const total = roundAmount(Number(pos.principal) + Number(pos.accrued));

    await AccountService.runInTransaction(async (tx) => {
      await AccountService.adjust(
        {
          userId,
          currency: pos.currency,
          accountType: "earn",
          availableDelta: -total,
          ledgerType: "transfer",
          ledgerAmount: -total,
          refId: genNo("ER"),
        },
        tx,
      );
      await AccountService.adjust(
        {
          userId,
          currency: pos.currency,
          accountType: "funding",
          availableDelta: total,
          ledgerType: "transfer",
          ledgerAmount: total,
          refId: genNo("ER"),
        },
        tx,
      );
      await sequelize.query(
        `UPDATE t_earn_position SET f_status = 'redeemed', f_principal = 0, f_accrued = 0
         WHERE f_id = :id`,
        { replacements: { id: positionId }, transaction: tx },
      );
    });
    return { redeemed: total };
  }

  /** 每日计息（worker 调用） */
  static async accrueDaily(): Promise<number> {
    const sequelize = await getSequelize();
    if (!sequelize) return 0;

    const positions = await sequelize.query<{
      id: number;
      userId: number;
      currency: string;
      principal: string;
      apr: string;
    }>(
      `SELECT p.f_id AS id, p.f_user_id AS userId, p.f_currency AS currency,
              p.f_principal AS principal, pr.f_apr AS apr
       FROM t_earn_position p
       JOIN t_earn_product pr ON pr.f_product_no = p.f_product_no
       WHERE p.f_status = 'active' AND p.f_principal > 0`,
      { type: QueryTypes.SELECT },
    );

    let count = 0;
    for (const pos of positions) {
      const interest = roundAmount(Number(pos.principal) * Number(pos.apr) / 365);
      if (interest <= 0) continue;
      await AccountService.runInTransaction(async (tx) => {
        await AccountService.adjust(
          {
            userId: pos.userId,
            currency: pos.currency,
            accountType: "earn",
            availableDelta: interest,
            ledgerType: "credit",
            ledgerAmount: interest,
            refId: `EARN${pos.id}`,
          },
          tx,
        );
        await sequelize.query(
          `UPDATE t_earn_position SET f_accrued = f_accrued + :interest WHERE f_id = :id`,
          { replacements: { interest, id: pos.id }, transaction: tx },
        );
      });
      count += 1;
    }
    return count;
  }
}

export class MarginService {
  static async getSummary(userId: number) {
    const sequelize = await getSequelize();
    if (!sequelize) return { loans: [], totalLiability: 0 };

    const loans = await sequelize.query(
      `SELECT f_id AS id, f_currency AS currency, f_principal AS principal,
              f_interest AS interest, f_hourly_rate AS hourlyRate, f_status AS status
       FROM t_spot_margin_loan WHERE f_user_id = :userId AND f_status = 'open'`,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
    const totalLiability = (loans as { principal: string; interest: string }[]).reduce(
      (s, l) => s + Number(l.principal) + Number(l.interest),
      0,
    );
    return { loans, totalLiability: roundAmount(totalLiability) };
  }

  static async borrow(userId: number, currency: string, amount: number) {
    const sequelize = await getSequelize();
    if (!sequelize) throw new BadRequestError("数据库未启用");
    const amt = roundAmount(amount);
    if (!(amt > 0)) throw new BadRequestError("借币数量无效");
    const cur = currency.toUpperCase();

    await AccountService.runInTransaction(async (tx) => {
      await AccountService.adjust(
        {
          userId,
          currency: cur,
          accountType: "margin",
          availableDelta: amt,
          ledgerType: "credit",
          ledgerAmount: amt,
          refId: genNo("BR"),
        },
        tx,
      );
      await sequelize.query(
        `INSERT INTO t_spot_margin_loan (f_user_id, f_currency, f_principal)
         VALUES (:userId, :currency, :amount)`,
        { replacements: { userId, currency: cur, amount: amt }, transaction: tx },
      );
    });
    return { borrowed: amt };
  }

  static async repay(userId: number, loanId: number) {
    const sequelize = await getSequelize();
    if (!sequelize) throw new BadRequestError("数据库未启用");

    const rows = await sequelize.query<{ currency: string; principal: string; interest: string }>(
      `SELECT f_currency AS currency, f_principal AS principal, f_interest AS interest
       FROM t_spot_margin_loan WHERE f_id = :id AND f_user_id = :userId AND f_status = 'open' LIMIT 1`,
      { replacements: { id: loanId, userId }, type: QueryTypes.SELECT },
    );
    const loan = rows[0];
    if (!loan) throw new BadRequestError("借贷记录不存在");
    const total = roundAmount(Number(loan.principal) + Number(loan.interest));

    await AccountService.runInTransaction(async (tx) => {
      const avail = await AccountService.getAvailable(userId, loan.currency, tx, "margin");
      if (avail < total) throw new BadRequestError("杠杆账户余额不足");
      await AccountService.adjust(
        {
          userId,
          currency: loan.currency,
          accountType: "margin",
          availableDelta: -total,
          ledgerType: "withdraw",
          ledgerAmount: -total,
          refId: genNo("RP"),
        },
        tx,
      );
      await sequelize.query(
        `UPDATE t_spot_margin_loan SET f_status = 'repaid', f_principal = 0, f_interest = 0 WHERE f_id = :id`,
        { replacements: { id: loanId }, transaction: tx },
      );
    });
    return { repaid: total };
  }
}

export class UnifiedAccountService {
  static async getMode(userId: number): Promise<"classic" | "unified"> {
    const sequelize = await getSequelize();
    if (!sequelize) return "classic";
    const rows = await sequelize.query<{ mode: string }>(
      `SELECT f_mode AS mode FROM t_user_account_mode WHERE f_user_id = :userId LIMIT 1`,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
    return (rows[0]?.mode as "classic" | "unified") ?? "classic";
  }

  static async setMode(userId: number, mode: "classic" | "unified") {
    const sequelize = await getSequelize();
    if (!sequelize) throw new BadRequestError("数据库未启用");
    await sequelize.query(
      `INSERT INTO t_user_account_mode (f_user_id, f_mode) VALUES (:userId, :mode)
       ON DUPLICATE KEY UPDATE f_mode = :mode`,
      { replacements: { userId, mode } },
    );
    return { mode };
  }

  static async getEquity(userId: number) {
    const balances = await AccountService.getBalances(userId);
    let equityUsd = 0;
    for (const b of balances) {
      if (b.accountType === "funding" || b.accountType === "trading" || b.accountType === "futures") {
        const rate = b.currency === "USDT" ? 1 : b.currency === "BTC" ? 65000 : b.currency === "ETH" ? 3500 : 1;
        equityUsd += (b.available + b.frozen) * rate;
      }
    }
    const sequelize = await getSequelize();
    let upnl = 0;
    if (sequelize) {
      const rows = await sequelize.query<{ upnl: string }>(
        `SELECT COALESCE(SUM(f_unrealized_pnl), 0) AS upnl FROM t_futures_position
         WHERE f_user_id = :userId AND f_status = 'open'`,
        { replacements: { userId }, type: QueryTypes.SELECT },
      );
      upnl = Number(rows[0]?.upnl ?? 0);
    }
    return {
      mode: await this.getMode(userId),
      equityUsd: roundAmount(equityUsd + upnl),
      unrealizedPnl: roundAmount(upnl),
    };
  }
}

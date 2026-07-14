import { QueryTypes } from "sequelize";
import { getSequelize } from "@/db/connection";
import { BadRequestError } from "@/errors/app-error";
import { AccountService, roundAmount } from "@/services/account/account.service";
import { fetchTrc20IncomingTransfers } from "@/billing/tron-grid";
import { config } from "@/config";

function genNo(prefix: string) {
  return `${prefix}${Date.now().toString(36)}`.toUpperCase();
}

export class TierService {
  static async getUserTier(userId: number) {
    const sequelize = await getSequelize();
    if (!sequelize) return null;

    const kyc = await sequelize.query<{ status: string }>(
      `SELECT f_status AS status FROM t_kyc_verification WHERE f_user_id = :userId LIMIT 1`,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
    const user = await sequelize.query<{ twoFa: number; roleKey: string }>(
      `SELECT u.f_two_fa_enabled AS twoFa, r.f_role_key AS roleKey
       FROM t_user u JOIN t_role r ON r.f_id = u.f_role_id WHERE u.f_id = :userId LIMIT 1`,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
    const volume = await sequelize.query<{ vol: string }>(
      `SELECT COALESCE(SUM(f_price * f_quantity), 0) AS vol FROM t_spot_trade
       WHERE f_user_id = :userId AND f_create_time > DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );

    const kycOk = kyc[0]?.status === "verified";
    const twoFa = Number(user[0]?.twoFa ?? 0) === 1;
    const vol30d = Number(volume[0]?.vol ?? 0);
    const isVip = user[0]?.roleKey === "vip_user";

    let tierKey = "regular";
    if (isVip || (kycOk && twoFa && vol30d >= 100000)) tierKey = "vip";
    else if (kycOk) tierKey = "verified";

    const tiers = await sequelize.query(
      `SELECT f_tier_key AS tierKey, f_tier_level AS tierLevel, f_name_zh AS nameZh,
              f_name_en AS nameEn, f_maker_fee AS makerFee, f_taker_fee AS takerFee,
              f_daily_withdraw_usd AS dailyWithdrawUsd
       FROM t_tier_config WHERE f_tier_key = :tierKey LIMIT 1`,
      { replacements: { tierKey }, type: QueryTypes.SELECT },
    );

    const nextTier =
      tierKey === "regular"
        ? "verified"
        : tierKey === "verified"
          ? "vip"
          : null;

    return {
      current: tiers[0] ?? null,
      progress: {
        kyc: kycOk,
        twoFa,
        volume30d: roundAmount(vol30d),
        volumeTarget: 100000,
      },
      nextTier,
    };
  }
}

export class SettlementService {
  static async runDailyBatch(): Promise<string> {
    const sequelize = await getSequelize();
    if (!sequelize) throw new BadRequestError("数据库未启用");

    const batchNo = genNo("SB");
    const settleDate = new Date().toISOString().slice(0, 10);

    const spotTrades = await sequelize.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM t_spot_trade WHERE DATE(f_create_time) = :d`,
      { replacements: { d: settleDate }, type: QueryTypes.SELECT },
    );
    const liq = await sequelize.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM t_adl_event WHERE DATE(f_create_time) = :d`,
      { replacements: { d: settleDate }, type: QueryTypes.SELECT },
    );

    const balances = await sequelize.query<{
      userId: number;
      currency: string;
      accountType: string;
      available: string;
      frozen: string;
    }>(
      `SELECT f_user_id AS userId, f_currency AS currency, f_account_type AS accountType,
              f_available AS available, f_frozen AS frozen FROM t_account_balance`,
      { type: QueryTypes.SELECT },
    );

    let diffs = 0;
    for (const b of balances) {
      const actual = roundAmount(Number(b.available) + Number(b.frozen));
      const ledgerRows = await sequelize.query<{ sum: string }>(
        `SELECT COALESCE(SUM(f_amount), 0) AS sum FROM t_account_ledger
         WHERE f_user_id = :userId AND f_currency = :currency`,
        {
          replacements: { userId: b.userId, currency: b.currency },
          type: QueryTypes.SELECT,
        },
      );
      const ledgerSum = Number(ledgerRows[0]?.sum ?? 0);
      const diff = roundAmount(actual - ledgerSum);
      if (Math.abs(diff) > 0.0001) diffs += 1;
      await sequelize.query(
        `INSERT INTO t_reconcile_snapshot
          (f_batch_no, f_user_id, f_currency, f_account_type, f_ledger_sum, f_balance_actual, f_diff)
         VALUES (:batchNo, :userId, :currency, :accountType, :ledgerSum, :actual, :diff)`,
        {
          replacements: {
            batchNo,
            userId: b.userId,
            currency: b.currency,
            accountType: b.accountType,
            ledgerSum,
            actual,
            diff,
          },
        },
      );
    }

    await sequelize.query(
      `INSERT INTO t_settlement_batch
        (f_batch_no, f_settle_date, f_spot_trades, f_liquidations, f_reconcile_diffs)
       VALUES (:batchNo, :settleDate, :spotTrades, :liq, :diffs)`,
      {
        replacements: {
          batchNo,
          settleDate,
          spotTrades: spotTrades[0]?.cnt ?? 0,
          liq: liq[0]?.cnt ?? 0,
          diffs,
        },
      },
    );
    return batchNo;
  }

  static async listBatches(limit = 30) {
    const sequelize = await getSequelize();
    if (!sequelize) return [];
    return sequelize.query(
      `SELECT f_batch_no AS batchNo, f_settle_date AS settleDate, f_spot_trades AS spotTrades,
              f_liquidations AS liquidations, f_reconcile_diffs AS reconcileDiffs,
              UNIX_TIMESTAMP(f_create_time)*1000 AS ts
       FROM t_settlement_batch ORDER BY f_id DESC LIMIT :limit`,
      { replacements: { limit }, type: QueryTypes.SELECT },
    );
  }
}

export class DepositWatcherService {
  static async scanTrc20Deposits(): Promise<number> {
    const sequelize = await getSequelize();
    if (!sequelize) return 0;

    const cursorRows = await sequelize.query<{ lastTs: number }>(
      `SELECT f_last_ts AS lastTs FROM t_chain_watch_cursor WHERE f_chain = 'TRC20' LIMIT 1`,
      { type: QueryTypes.SELECT },
    );
    let minTs = cursorRows[0]?.lastTs ?? Date.now() - 86400000;

    const addresses = await sequelize.query<{ userId: number; address: string; currency: string }>(
      `SELECT f_user_id AS userId, f_address AS address, f_currency AS currency
       FROM t_deposit_address WHERE f_chain = 'TRC20' AND f_currency = 'USDT'`,
      { type: QueryTypes.SELECT },
    );

    let matched = 0;
    for (const addr of addresses) {
      try {
        const transfers =
          config.billing.tron.usdtContract && config.billing.tron.apiBaseUrl
            ? await fetchTrc20IncomingTransfers(addr.address, minTs)
            : [];

        for (const tx of transfers) {
          const exists = await sequelize.query(
            `SELECT 1 FROM t_chain_tx_log WHERE f_tx_hash = :hash AND f_chain = 'TRC20' LIMIT 1`,
            { replacements: { hash: tx.txHash }, type: QueryTypes.SELECT },
          );
          if (exists.length > 0) continue;

          const amount = roundAmount(Number(tx.amountUsdt));
          await sequelize.query(
            `INSERT INTO t_chain_tx_log (f_tx_hash, f_chain, f_to_address, f_amount, f_currency)
             VALUES (:hash, 'TRC20', :to, :amount, 'USDT')`,
            {
              replacements: { hash: tx.txHash, to: tx.to, amount },
            },
          );

          const depositNo = genNo("DP");
          await AccountService.runInTransaction(async (txDb) => {
            await AccountService.adjust(
              {
                userId: addr.userId,
                currency: "USDT",
                accountType: "funding",
                availableDelta: amount,
                ledgerType: "deposit",
                ledgerAmount: amount,
                refId: depositNo,
              },
              txDb,
            );
            await sequelize.query(
              `INSERT INTO t_deposit_record
                (f_deposit_no, f_user_id, f_currency, f_chain, f_amount, f_tx_hash, f_status)
               VALUES (:depositNo, :userId, 'USDT', 'TRC20', :amount, :hash, 'confirmed')`,
              {
                replacements: {
                  depositNo,
                  userId: addr.userId,
                  amount,
                  hash: tx.txHash,
                },
                transaction: txDb,
              },
            );
          });
          matched += 1;
          if (tx.blockTimestamp > minTs) minTs = tx.blockTimestamp;
        }
      } catch {
        /* skip address on RPC failure */
      }
    }

    await sequelize.query(
      `INSERT INTO t_chain_watch_cursor (f_chain, f_last_ts) VALUES ('TRC20', :ts)
       ON DUPLICATE KEY UPDATE f_last_ts = GREATEST(f_last_ts, :ts)`,
      { replacements: { ts: minTs } },
    );
    return matched;
  }
}

export class AmlService {
  static async checkWithdraw(input: {
    userId: number;
    currency: string;
    amount: number;
    address: string;
    chain?: string;
  }) {
    const sequelize = await getSequelize();
    if (!sequelize) return;

    const blacklisted = await sequelize.query(
      `SELECT 1 FROM t_address_blacklist
       WHERE f_address = :address AND f_chain = :chain LIMIT 1`,
      {
        replacements: { address: input.address.trim(), chain: input.chain ?? "TRC20" },
        type: QueryTypes.SELECT,
      },
    );
    if (blacklisted.length > 0) {
      throw new BadRequestError("提现地址已被限制");
    }

    if (input.amount > 50000 && input.currency === "USDT") {
      await sequelize.query(
        `INSERT INTO t_aml_alert (f_user_id, f_alert_type, f_amount, f_currency, f_detail)
         VALUES (:userId, 'large_withdraw', :amount, :currency, :detail)`,
        {
          replacements: {
            userId: input.userId,
            amount: input.amount,
            currency: input.currency,
            detail: `Withdraw to ${input.address}`,
          },
        },
      );
    }
  }

  static async listAlerts(userId?: number, limit = 50) {
    const sequelize = await getSequelize();
    if (!sequelize) return [];
    const where = userId ? "WHERE f_user_id = :userId" : "";
    return sequelize.query(
      `SELECT f_id AS id, f_user_id AS userId, f_alert_type AS alertType, f_amount AS amount,
              f_currency AS currency, f_status AS status, UNIX_TIMESTAMP(f_create_time)*1000 AS ts
       FROM t_aml_alert ${where} ORDER BY f_id DESC LIMIT :limit`,
      { replacements: { userId, limit }, type: QueryTypes.SELECT },
    );
  }
}

export class KybService {
  static async submit(input: {
    userId: number;
    companyName: string;
    regNo: string;
    contactName: string;
  }) {
    const sequelize = await getSequelize();
    if (!sequelize) throw new BadRequestError("数据库未启用");
    await sequelize.query(
      `INSERT INTO t_kyb_verification (f_user_id, f_company_name, f_reg_no, f_contact_name, f_status)
       VALUES (:userId, :companyName, :regNo, :contactName, 'pending')
       ON DUPLICATE KEY UPDATE f_company_name = :companyName, f_reg_no = :regNo,
         f_contact_name = :contactName, f_status = 'pending'`,
      { replacements: input },
    );
    return { status: "pending" };
  }

  static async getStatus(userId: number) {
    const sequelize = await getSequelize();
    if (!sequelize) return { status: "none" };
    const rows = await sequelize.query(
      `SELECT f_company_name AS companyName, f_reg_no AS regNo, f_status AS status,
              f_reject_reason AS rejectReason
       FROM t_kyb_verification WHERE f_user_id = :userId LIMIT 1`,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
    return rows[0] ?? { status: "none" };
  }

  static async adminReview(userId: number, approve: boolean, reason?: string) {
    const sequelize = await getSequelize();
    if (!sequelize) throw new BadRequestError("数据库未启用");
    await sequelize.query(
      `UPDATE t_kyb_verification SET f_status = :status, f_reject_reason = :reason
       WHERE f_user_id = :userId`,
      {
        replacements: {
          userId,
          status: approve ? "verified" : "rejected",
          reason: reason ?? null,
        },
      },
    );
    return { ok: true };
  }
}

import { QueryTypes } from "sequelize";
import { config } from "@/config";
import { getSequelize } from "@/db/connection";
import { BadRequestError, NotFoundError } from "@/errors/app-error";
import { AccountService, roundAmount } from "@/services/account";
import { NotificationService } from "@/services/notification/notification.service";

export interface WithdrawRow {
  id: number;
  withdrawNo: string;
  userId: number;
  currency: string;
  chain: string;
  amount: number;
  fee: number;
  address: string;
  memo: string;
  status: string;
  rejectReason: string;
  txHash: string;
  ts: number;
}

export class AdminWithdrawService {
  static async listPending(page = 1, pageSize = 50) {
    const sequelize = await getSequelize();
    if (!sequelize) return { rows: [], total: 0 };

    const offset = (page - 1) * pageSize;
    const rows = await sequelize.query<WithdrawRow>(
      `SELECT f_id AS id, f_withdraw_no AS withdrawNo, f_user_id AS userId,
              f_currency AS currency, f_chain AS chain, f_amount AS amount, f_fee AS fee,
              f_address AS address, f_memo AS memo, f_status AS status,
              f_reject_reason AS rejectReason, f_tx_hash AS txHash,
              UNIX_TIMESTAMP(f_create_time)*1000 AS ts
       FROM t_withdrawal_request
       WHERE f_status IN ('pending', 'processing')
       ORDER BY f_id ASC LIMIT :limit OFFSET :offset`,
      { replacements: { limit: pageSize, offset }, type: QueryTypes.SELECT },
    );
    const total = await sequelize.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM t_withdrawal_request WHERE f_status IN ('pending', 'processing')`,
      { type: QueryTypes.SELECT },
    );
    return { rows, total: total[0]?.cnt ?? 0, page, pageSize };
  }

  static async approve(withdrawNo: string, operatorId: number, txHash?: string) {
    if (!config.db.enabled) throw new BadRequestError("数据库未启用");

    const sequelize = await getSequelize();
    const rows = await sequelize!.query<{
      userId: number;
      currency: string;
      amount: number;
      fee: number;
      status: string;
    }>(
      `SELECT f_user_id AS userId, f_currency AS currency, f_amount AS amount,
              f_fee AS fee, f_status AS status
       FROM t_withdrawal_request WHERE f_withdraw_no = :withdrawNo LIMIT 1`,
      { replacements: { withdrawNo }, type: QueryTypes.SELECT },
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("提现单不存在");
    if (row.status !== "pending" && row.status !== "processing") {
      throw new BadRequestError("该提现单状态不可审批");
    }

    const total = roundAmount(Number(row.amount) + Number(row.fee));

    await AccountService.runInTransaction(async (tx) => {
      await AccountService.adjust(
        {
          userId: row.userId,
          currency: row.currency,
          accountType: "funding",
          frozenDelta: -total,
          ledgerType: "withdraw",
          ledgerAmount: -total,
          refId: withdrawNo,
        },
        tx,
      );

      await sequelize!.query(
        `UPDATE t_withdrawal_request
         SET f_status = 'completed', f_tx_hash = :txHash, f_update_time = NOW()
         WHERE f_withdraw_no = :withdrawNo`,
        {
          replacements: {
            withdrawNo,
            txHash: txHash?.trim() || `sim_${Date.now().toString(36)}`,
          },
          transaction: tx,
        },
      );
    });

    await NotificationService.create(row.userId, {
      type: "withdraw",
      title: "提现已完成",
      body: `${row.amount} ${row.currency} 已转出`,
      refId: withdrawNo,
    });

    return { withdrawNo, status: "completed" as const, operatorId };
  }

  static async reject(withdrawNo: string, operatorId: number, reason: string) {
    if (!config.db.enabled) throw new BadRequestError("数据库未启用");

    const sequelize = await getSequelize();
    const rows = await sequelize!.query<{
      userId: number;
      currency: string;
      amount: number;
      fee: number;
      status: string;
    }>(
      `SELECT f_user_id AS userId, f_currency AS currency, f_amount AS amount,
              f_fee AS fee, f_status AS status
       FROM t_withdrawal_request WHERE f_withdraw_no = :withdrawNo LIMIT 1`,
      { replacements: { withdrawNo }, type: QueryTypes.SELECT },
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("提现单不存在");
    if (row.status !== "pending" && row.status !== "processing") {
      throw new BadRequestError("该提现单状态不可拒绝");
    }

    const total = roundAmount(Number(row.amount) + Number(row.fee));

    await AccountService.runInTransaction(async (tx) => {
      await AccountService.adjust(
        {
          userId: row.userId,
          currency: row.currency,
          accountType: "funding",
          availableDelta: total,
          frozenDelta: -total,
          ledgerType: "unfreeze",
          ledgerAmount: total,
          refId: withdrawNo,
        },
        tx,
      );

      await sequelize!.query(
        `UPDATE t_withdrawal_request
         SET f_status = 'rejected', f_reject_reason = :reason, f_update_time = NOW()
         WHERE f_withdraw_no = :withdrawNo`,
        { replacements: { withdrawNo, reason: reason || "审核未通过" }, transaction: tx },
      );
    });

    await NotificationService.create(row.userId, {
      type: "withdraw",
      title: "提现被拒绝",
      body: reason || "审核未通过，资金已退回",
      refId: withdrawNo,
    });

    return { withdrawNo, status: "rejected" as const, operatorId };
  }

  /** 管理员确认链上充币入账（专业流程：人工/扫描器确认后调用） */
  static async confirmDeposit(input: {
    userId: number;
    currency: string;
    chain: string;
    amount: number;
    txHash: string;
    operatorId: number;
  }) {
    if (!config.db.enabled) throw new BadRequestError("数据库未启用");
    const amount = roundAmount(input.amount);
    if (!(amount > 0)) throw new BadRequestError("金额无效");

    const depositNo = `DP${Date.now().toString(36)}`.toUpperCase();
    const sequelize = await getSequelize();

    await AccountService.runInTransaction(async (tx) => {
      await sequelize!.query(
        `INSERT INTO t_deposit_record
          (f_deposit_no, f_user_id, f_currency, f_chain, f_amount, f_tx_hash, f_status, f_confirmations)
         VALUES (:depositNo, :userId, :currency, :chain, :amount, :txHash, 'confirmed', 12)`,
        {
          replacements: {
            depositNo,
            userId: input.userId,
            currency: input.currency.toUpperCase(),
            chain: input.chain,
            amount,
            txHash: input.txHash,
          },
          transaction: tx,
        },
      );

      await AccountService.adjust(
        {
          userId: input.userId,
          currency: input.currency.toUpperCase(),
          accountType: "funding",
          availableDelta: amount,
          ledgerType: "deposit",
          ledgerAmount: amount,
          refId: depositNo,
        },
        tx,
      );
    });

    await NotificationService.create(input.userId, {
      type: "deposit",
      title: "充币到账",
      body: `${amount} ${input.currency.toUpperCase()} 已入账资金账户`,
      refId: depositNo,
    });

    return { depositNo, status: "confirmed" as const };
  }
}

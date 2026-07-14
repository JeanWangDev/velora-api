import crypto from "crypto";
import { QueryTypes } from "sequelize";
import { config } from "@/config";
import { getSequelize } from "@/db/connection";
import { BadRequestError } from "@/errors/app-error";
import {
  AccountService,
  roundAmount,
  type AccountType,
} from "@/services/account/account.service";
import { NotificationService } from "@/services/notification/notification.service";
import { CapitalRiskService } from "@/services/risk/capital-risk.service";
import { AmlService } from "@/services/platform/compliance.service";
import { DEPOSIT_CHAINS, WITHDRAW_FEE_RATES } from "@/constants/exchange";

function genNo(prefix: string) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

function deriveAddress(userId: number, currency: string, chain: string): string {
  const seed = crypto
    .createHash("sha256")
    .update(`${userId}:${currency}:${chain}:velora`)
    .digest("hex");
  if (chain === "TRC20") return `T${seed.slice(0, 33).toUpperCase()}`;
  if (chain === "BTC") return `bc1q${seed.slice(0, 38)}`;
  return `0x${seed.slice(0, 40)}`;
}

export class WalletService {
  static async getDepositAddress(userId: number, currency: string, chain: string) {
    const cur = currency.toUpperCase();
    const chains = DEPOSIT_CHAINS[cur];
    if (!chains?.includes(chain)) {
      throw new BadRequestError(`不支持 ${cur} 的 ${chain} 网络`);
    }

    const sequelize = await getSequelize();
    if (!sequelize) throw new BadRequestError("数据库未启用");

    const existing = await sequelize.query<{
      address: string;
      memo: string;
    }>(
      `SELECT f_address AS address, f_memo AS memo FROM t_deposit_address
       WHERE f_user_id = :userId AND f_currency = :currency AND f_chain = :chain LIMIT 1`,
      {
        replacements: { userId, currency: cur, chain },
        type: QueryTypes.SELECT,
      },
    );
    if (existing[0]) return existing[0];

    const address = deriveAddress(userId, cur, chain);
    await sequelize.query(
      `INSERT INTO t_deposit_address (f_user_id, f_currency, f_chain, f_address)
       VALUES (:userId, :currency, :chain, :address)`,
      { replacements: { userId, currency: cur, chain, address } },
    );
    return { address, memo: "" };
  }

  /** 用户发起链上提现（冻结资金账户余额，进入审核队列） */
  static async requestWithdraw(input: {
    userId: number;
    currency: string;
    chain: string;
    amount: number;
    address: string;
    memo?: string;
  }) {
    if (!config.db.enabled) throw new BadRequestError("数据库未启用");

    const cur = input.currency.toUpperCase();
    const amount = roundAmount(input.amount);
    const feeCfg = WITHDRAW_FEE_RATES[cur] ?? { rate: 0.001, min: 1 };
    const fee = roundAmount(Math.max(amount * feeCfg.rate, feeCfg.min));
    const total = roundAmount(amount + fee);

    if (!(amount > 0)) throw new BadRequestError("提现金额必须大于 0");
    if (!input.address?.trim()) throw new BadRequestError("请填写提现地址");

    await CapitalRiskService.assertWithdrawAllowed({
      userId: input.userId,
      currency: cur,
      amount,
      address: input.address.trim(),
    });

    await AmlService.checkWithdraw({
      userId: input.userId,
      currency: cur,
      amount,
      address: input.address.trim(),
      chain: input.chain,
    });

    const withdrawNo = genNo("WD");

    await AccountService.runInTransaction(async (tx) => {
      const avail = await AccountService.getAvailable(input.userId, cur, tx, "funding");
      if (avail < total) throw new BadRequestError(`${cur} 资金账户余额不足`);

      await AccountService.adjust(
        {
          userId: input.userId,
          currency: cur,
          accountType: "funding",
          availableDelta: -total,
          frozenDelta: total,
          ledgerType: "freeze",
          ledgerAmount: -total,
          refId: withdrawNo,
        },
        tx,
      );

      const sequelize = await getSequelize();
      await sequelize!.query(
        `INSERT INTO t_withdrawal_request
          (f_withdraw_no, f_user_id, f_currency, f_chain, f_amount, f_fee, f_address, f_memo, f_status)
         VALUES (:withdrawNo, :userId, :currency, :chain, :amount, :fee, :address, :memo, 'pending')`,
        {
          replacements: {
            withdrawNo,
            userId: input.userId,
            currency: cur,
            chain: input.chain,
            amount,
            fee,
            address: input.address.trim(),
            memo: input.memo ?? "",
          },
          transaction: tx,
        },
      );
    });

    await NotificationService.create(input.userId, {
      type: "withdraw",
      title: "提现已提交",
      body: `${amount} ${cur} 提现申请已提交，等待审核`,
      refId: withdrawNo,
    });

    return { withdrawNo, status: "pending" as const };
  }

  static async listDeposits(userId: number, page = 1, pageSize = 20) {
    const sequelize = await getSequelize();
    if (!sequelize) return { rows: [], total: 0 };

    const offset = (page - 1) * pageSize;
    const rows = await sequelize.query(
      `SELECT f_deposit_no AS depositNo, f_currency AS currency, f_chain AS chain,
              f_amount AS amount, f_status AS status, f_tx_hash AS txHash,
              UNIX_TIMESTAMP(f_create_time)*1000 AS ts
       FROM t_deposit_record WHERE f_user_id = :userId
       ORDER BY f_id DESC LIMIT :limit OFFSET :offset`,
      { replacements: { userId, limit: pageSize, offset }, type: QueryTypes.SELECT },
    );
    const total = await sequelize.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM t_deposit_record WHERE f_user_id = :userId`,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
    return { rows, total: total[0]?.cnt ?? 0, page, pageSize };
  }

  static async listWithdrawals(userId: number, page = 1, pageSize = 20) {
    const sequelize = await getSequelize();
    if (!sequelize) return { rows: [], total: 0 };

    const offset = (page - 1) * pageSize;
    const rows = await sequelize.query(
      `SELECT f_withdraw_no AS withdrawNo, f_currency AS currency, f_chain AS chain,
              f_amount AS amount, f_fee AS fee, f_address AS address, f_status AS status,
              f_tx_hash AS txHash, UNIX_TIMESTAMP(f_create_time)*1000 AS ts
       FROM t_withdrawal_request WHERE f_user_id = :userId
       ORDER BY f_id DESC LIMIT :limit OFFSET :offset`,
      { replacements: { userId, limit: pageSize, offset }, type: QueryTypes.SELECT },
    );
    const total = await sequelize.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM t_withdrawal_request WHERE f_user_id = :userId`,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
    return { rows, total: total[0]?.cnt ?? 0, page, pageSize };
  }

  static listChains() {
    return DEPOSIT_CHAINS;
  }
}

export class TransferService {
  static async transfer(input: {
    userId: number;
    currency: string;
    amount: number;
    fromAccount: AccountType;
    toAccount: AccountType;
  }) {
    const cur = input.currency.toUpperCase();
    const amount = roundAmount(input.amount);
    if (!(amount > 0)) throw new BadRequestError("划转金额必须大于 0");
    if (input.fromAccount === input.toAccount) {
      throw new BadRequestError("来源与目标账户不能相同");
    }

    const transferNo = genNo("TR");

    await AccountService.runInTransaction(async (tx) => {
      const avail = await AccountService.getAvailable(
        input.userId,
        cur,
        tx,
        input.fromAccount,
      );
      if (avail < amount) throw new BadRequestError("余额不足");

      await AccountService.adjust(
        {
          userId: input.userId,
          currency: cur,
          accountType: input.fromAccount,
          availableDelta: -amount,
          ledgerType: "transfer",
          ledgerAmount: -amount,
          refId: transferNo,
        },
        tx,
      );
      await AccountService.adjust(
        {
          userId: input.userId,
          currency: cur,
          accountType: input.toAccount,
          availableDelta: amount,
          ledgerType: "transfer",
          ledgerAmount: amount,
          refId: transferNo,
        },
        tx,
      );

      const sequelize = await getSequelize();
      await sequelize!.query(
        `INSERT INTO t_account_transfer
          (f_transfer_no, f_user_id, f_currency, f_amount, f_from_account, f_to_account)
         VALUES (:transferNo, :userId, :currency, :amount, :fromAccount, :toAccount)`,
        {
          replacements: {
            transferNo,
            userId: input.userId,
            currency: cur,
            amount,
            fromAccount: input.fromAccount,
            toAccount: input.toAccount,
          },
          transaction: tx,
        },
      );
    });

    return { transferNo, status: "completed" as const };
  }

  static async listTransfers(userId: number, page = 1, pageSize = 20) {
    const sequelize = await getSequelize();
    if (!sequelize) return { rows: [], total: 0 };

    const offset = (page - 1) * pageSize;
    const rows = await sequelize.query(
      `SELECT f_transfer_no AS transferNo, f_currency AS currency, f_amount AS amount,
              f_from_account AS fromAccount, f_to_account AS toAccount, f_status AS status,
              UNIX_TIMESTAMP(f_create_time)*1000 AS ts
       FROM t_account_transfer WHERE f_user_id = :userId
       ORDER BY f_id DESC LIMIT :limit OFFSET :offset`,
      { replacements: { userId, limit: pageSize, offset }, type: QueryTypes.SELECT },
    );
    const total = await sequelize.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM t_account_transfer WHERE f_user_id = :userId`,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
    return { rows, total: total[0]?.cnt ?? 0, page, pageSize };
  }
}

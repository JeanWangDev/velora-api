import type { Transaction } from "sequelize";
import { config } from "@/config";
import { AccountBalance, AccountLedger, type LedgerType } from "@/db";
import { getSequelize } from "@/db/connection";
import { BadRequestError } from "@/errors/app-error";

const SCALE = 12;
const EPSILON = 1e-9;

/** 统一四舍五入到账本精度，避免浮点误差累积 */
export function roundAmount(value: number): number {
  return Number(value.toFixed(SCALE));
}

export interface BalanceView {
  currency: string;
  accountType: AccountType;
  available: number;
  frozen: number;
}

export type AccountType = "funding" | "trading" | "futures" | "earn" | "margin";

export interface LedgerView {
  id: number;
  currency: string;
  accountType: AccountType;
  type: LedgerType;
  amount: number;
  balanceAfter: number;
  refId: string;
  ts: number;
}

interface AdjustParams {
  userId: number;
  currency: string;
  accountType?: AccountType;
  /** 可用余额变动（正加负减） */
  availableDelta?: number;
  /** 冻结余额变动（正加负减） */
  frozenDelta?: number;
  /** 若提供则写一条流水 */
  ledgerType?: LedgerType;
  ledgerAmount?: number;
  refId?: string;
}

function assertDbReady() {
  if (!config.db.enabled) {
    throw new BadRequestError("数据库未启用");
  }
}

export class AccountService {
  /** 在事务中执行一段账户相关逻辑 */
  static async runInTransaction<T>(
    fn: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    assertDbReady();
    const sequelize = await getSequelize();
    if (!sequelize) {
      throw new BadRequestError("数据库未启用");
    }
    return sequelize.transaction(fn);
  }

  /** 查询用户全部余额（可按账户类型筛选） */
  static async getBalances(
    userId: number,
    accountType?: AccountType,
  ): Promise<BalanceView[]> {
    assertDbReady();
    const where: Record<string, unknown> = { userId };
    if (accountType) where.accountType = accountType;
    const rows = await AccountBalance.findAll({
      where,
      order: [
        ["accountType", "ASC"],
        ["currency", "ASC"],
      ],
    });
    return rows.map((r) => ({
      currency: r.currency,
      accountType: (r.accountType ?? "trading") as AccountType,
      available: Number(r.available),
      frozen: Number(r.frozen),
    }));
  }

  /** 分页查询资金流水 */
  static async getLedger(
    userId: number,
    options?: {
      page?: number;
      pageSize?: number;
      currency?: string;
      accountType?: AccountType;
      type?: LedgerType;
    },
  ): Promise<{ rows: LedgerView[]; total: number; page: number; pageSize: number }> {
    assertDbReady();
    const page = Math.max(1, options?.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, options?.pageSize ?? 50));
    const offset = (page - 1) * pageSize;
    const where: Record<string, unknown> = { userId };
    if (options?.currency) where.currency = options.currency.toUpperCase();
    if (options?.accountType) where.accountType = options.accountType;
    if (options?.type) where.type = options.type;

    const { rows, count } = await AccountLedger.findAndCountAll({
      where,
      order: [["id", "DESC"]],
      limit: pageSize,
      offset,
    });

    return {
      rows: rows.map((r) => ({
        id: r.id,
        currency: r.currency,
        accountType: (r.accountType ?? "trading") as AccountType,
        type: r.type,
        amount: Number(r.amount),
        balanceAfter: Number(r.balanceAfter),
        refId: r.refId,
        ts: r.createTime.getTime(),
      })),
      total: count,
      page,
      pageSize,
    };
  }

  /** 事务内锁定（或创建）余额行 */
  private static async lockBalance(
    userId: number,
    currency: string,
    tx: Transaction,
    accountType: AccountType = "trading",
  ): Promise<AccountBalance> {
    let row = await AccountBalance.findOne({
      where: { userId, currency, accountType },
      transaction: tx,
      lock: tx.LOCK.UPDATE,
    });
    if (!row) {
      await AccountBalance.create(
        { userId, currency, accountType, available: 0, frozen: 0 },
        { transaction: tx },
      );
      row = await AccountBalance.findOne({
        where: { userId, currency, accountType },
        transaction: tx,
        lock: tx.LOCK.UPDATE,
      });
    }
    return row!;
  }

  /** 事务内的原子余额调整（可附带流水） */
  static async adjust(params: AdjustParams, tx: Transaction): Promise<number> {
    const accountType = params.accountType ?? "trading";
    const row = await this.lockBalance(params.userId, params.currency, tx, accountType);

    const nextAvailable = roundAmount(
      Number(row.available) + (params.availableDelta ?? 0),
    );
    const nextFrozen = roundAmount(Number(row.frozen) + (params.frozenDelta ?? 0));

    if (nextAvailable < -EPSILON || nextFrozen < -EPSILON) {
      throw new BadRequestError("余额不足");
    }

    row.available = String(Math.max(0, nextAvailable));
    row.frozen = String(Math.max(0, nextFrozen));
    row.updateTime = new Date();
    await row.save({ transaction: tx });

    const balanceAfter = roundAmount(nextAvailable + nextFrozen);

    if (params.ledgerType) {
      await AccountLedger.create(
        {
          userId: params.userId,
          currency: params.currency,
          accountType,
          type: params.ledgerType,
          amount: params.ledgerAmount ?? 0,
          balanceAfter,
          refId: params.refId ?? "",
        },
        { transaction: tx },
      );
    }

    return balanceAfter;
  }

  /** 读取可用余额（可在事务内） */
  static async getAvailable(
    userId: number,
    currency: string,
    tx?: Transaction,
    accountType: AccountType = "trading",
  ): Promise<number> {
    const row = await AccountBalance.findOne({
      where: { userId, currency, accountType },
      transaction: tx,
    });
    return row ? Number(row.available) : 0;
  }

  /** 管理端模拟充值（记为 deposit 流水） */
  static async credit(
    userId: number,
    currency: string,
    amount: number,
  ): Promise<BalanceView[]> {
    assertDbReady();
    const value = roundAmount(amount);
    if (!(value > 0)) {
      throw new BadRequestError("充值金额必须大于 0");
    }

    await this.runInTransaction((tx) =>
      this.adjust(
        {
          userId,
          currency: currency.toUpperCase(),
          accountType: "funding",
          availableDelta: value,
          ledgerType: "deposit",
          ledgerAmount: value,
          refId: `credit-${Date.now()}`,
        },
        tx,
      ),
    );

    return this.getBalances(userId);
  }
}

import { Op } from "sequelize";
import { config } from "@/config";
import { AdminFinanceOp, User, type AdminFinanceOpType } from "@/db";
import { BadRequestError, NotFoundError } from "@/errors/app-error";
import { AccountService, type BalanceView } from "@/services/account";

function assertDbReady() {
  if (!config.db.enabled) {
    throw new BadRequestError("数据库未启用");
  }
}

function genOpNo(): string {
  return `AF${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)
    .toString(36)
    .padStart(4, "0")}`.toUpperCase();
}

export interface AdminFinanceOpView {
  opNo: string;
  operatorId: number;
  operatorEmail: string;
  targetUserId: number;
  targetEmail: string;
  currency: string;
  amount: number;
  type: AdminFinanceOpType;
  remark: string;
  ts: number;
}

export class AdminFinanceService {
  /** 模拟充值（记录操作人） */
  static async credit(
    targetUserId: number,
    currency: string,
    amount: number,
    operatorId: number,
    remark?: string,
  ): Promise<{ balances: BalanceView[]; op: AdminFinanceOpView }> {
    assertDbReady();
    const value = amount;
    if (!(value > 0)) {
      throw new BadRequestError("充值金额必须大于 0");
    }

    await AdminFinanceService.assertUserExists(targetUserId);
    await AdminFinanceService.assertUserExists(operatorId);

    const opNo = genOpNo();
    const cur = currency.toUpperCase();

    await AccountService.runInTransaction(async (tx) => {
      await AccountService.adjust(
        {
          userId: targetUserId,
          currency: cur,
          accountType: "funding",
          availableDelta: value,
          ledgerType: "deposit",
          ledgerAmount: value,
          refId: opNo,
        },
        tx,
      );
      await AdminFinanceOp.create(
        {
          opNo,
          operatorId,
          targetUserId,
          currency: cur,
          amount: value,
          type: "credit",
          remark: remark?.trim() ?? "",
        },
        { transaction: tx },
      );
    });

    const balances = await AccountService.getBalances(targetUserId);
    const op = await AdminFinanceService.getOpByNo(opNo);
    return { balances, op };
  }

  /** 模拟扣减（负向调账） */
  static async debit(
    targetUserId: number,
    currency: string,
    amount: number,
    operatorId: number,
    remark?: string,
  ): Promise<{ balances: BalanceView[]; op: AdminFinanceOpView }> {
    assertDbReady();
    const value = amount;
    if (!(value > 0)) {
      throw new BadRequestError("扣减金额必须大于 0");
    }

    await AdminFinanceService.assertUserExists(targetUserId);
    await AdminFinanceService.assertUserExists(operatorId);

    const opNo = genOpNo();
    const cur = currency.toUpperCase();

    await AccountService.runInTransaction(async (tx) => {
      await AccountService.adjust(
        {
          userId: targetUserId,
          currency: cur,
          accountType: "funding",
          availableDelta: -value,
          ledgerType: "withdraw",
          ledgerAmount: -value,
          refId: opNo,
        },
        tx,
      );
      await AdminFinanceOp.create(
        {
          opNo,
          operatorId,
          targetUserId,
          currency: cur,
          amount: -value,
          type: "debit",
          remark: remark?.trim() ?? "",
        },
        { transaction: tx },
      );
    });

    const balances = await AccountService.getBalances(targetUserId);
    const op = await AdminFinanceService.getOpByNo(opNo);
    return { balances, op };
  }

  /** 分页查询管理端资金操作记录 */
  static async listOps(options?: {
    page?: number;
    pageSize?: number;
    targetUserId?: number;
    currency?: string;
    type?: AdminFinanceOpType;
  }): Promise<{ rows: AdminFinanceOpView[]; total: number; page: number; pageSize: number }> {
    assertDbReady();
    const page = Math.max(1, options?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, options?.pageSize ?? 20));
    const offset = (page - 1) * pageSize;
    const where: Record<string, unknown> = {};

    if (options?.targetUserId) where.targetUserId = options.targetUserId;
    if (options?.currency) where.currency = options.currency.toUpperCase();
    if (options?.type) where.type = options.type;

    const { rows, count } = await AdminFinanceOp.findAndCountAll({
      where,
      order: [["id", "DESC"]],
      limit: pageSize,
      offset,
    });

    const views = await AdminFinanceService.mapOpsWithUsers(rows);
    return { rows: views, total: count, page, pageSize };
  }

  /** 查询指定用户余额（管理端） */
  static async getUserBalances(userId: number): Promise<{
    userId: number;
    email: string;
    nickname: string;
    balances: BalanceView[];
  }> {
    assertDbReady();
    const user = await User.findByPk(userId);
    if (!user) {
      throw new NotFoundError("用户不存在");
    }
    const balances = await AccountService.getBalances(userId);
    return {
      userId: user.id,
      email: user.email,
      nickname: user.nickname,
      balances,
    };
  }

  private static async assertUserExists(userId: number) {
    const user = await User.findByPk(userId);
    if (!user) {
      throw new NotFoundError("用户不存在");
    }
  }

  private static async getOpByNo(opNo: string): Promise<AdminFinanceOpView> {
    const row = await AdminFinanceOp.findOne({ where: { opNo } });
    if (!row) {
      throw new NotFoundError("操作记录不存在");
    }
    const [view] = await AdminFinanceService.mapOpsWithUsers([row]);
    return view;
  }

  private static async mapOpsWithUsers(rows: AdminFinanceOp[]): Promise<AdminFinanceOpView[]> {
    if (rows.length === 0) return [];

    const userIds = new Set<number>();
    for (const row of rows) {
      userIds.add(row.operatorId);
      userIds.add(row.targetUserId);
    }

    const users = await User.findAll({
      where: { id: { [Op.in]: [...userIds] } },
      attributes: ["id", "email"],
    });
    const emailMap = new Map(users.map((u) => [u.id, u.email]));

    return rows.map((row) => ({
      opNo: row.opNo,
      operatorId: row.operatorId,
      operatorEmail: emailMap.get(row.operatorId) ?? "—",
      targetUserId: row.targetUserId,
      targetEmail: emailMap.get(row.targetUserId) ?? "—",
      currency: row.currency,
      amount: Number(row.amount),
      type: row.type,
      remark: row.remark,
      ts: row.createTime.getTime(),
    }));
  }
}

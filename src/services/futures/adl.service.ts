import { QueryTypes } from "sequelize";
import { getSequelize } from "@/db/connection";
import { AccountService, roundAmount } from "@/services/account/account.service";
import { FuturesEngineService } from "@/services/futures/futures-engine.service";
import { NotificationService } from "@/services/notification/notification.service";

export class InsuranceFundService {
  static async credit(symbol: string, currency: string, amount: number, refId: string) {
    const sequelize = await getSequelize();
    if (!sequelize || amount <= 0) return;
    await sequelize.query(
      `INSERT INTO t_insurance_fund (f_symbol, f_currency, f_balance)
       VALUES (:symbol, :currency, :amount)
       ON DUPLICATE KEY UPDATE f_balance = f_balance + :amount`,
      { replacements: { symbol, currency, amount } },
    );
    void refId;
  }

  static async debit(symbol: string, currency: string, amount: number): Promise<number> {
    const sequelize = await getSequelize();
    if (!sequelize) return 0;
    const rows = await sequelize.query<{ balance: string }>(
      `SELECT f_balance AS balance FROM t_insurance_fund
       WHERE f_symbol = :symbol AND f_currency = :currency LIMIT 1`,
      { replacements: { symbol, currency }, type: QueryTypes.SELECT },
    );
    const avail = Number(rows[0]?.balance ?? 0);
    const used = roundAmount(Math.min(avail, amount));
    if (used <= 0) return 0;
    await sequelize.query(
      `UPDATE t_insurance_fund SET f_balance = f_balance - :used
       WHERE f_symbol = :symbol AND f_currency = :currency`,
      { replacements: { symbol, currency, used } },
    );
    return used;
  }

  static async listBalances() {
    const sequelize = await getSequelize();
    if (!sequelize) return [];
    return sequelize.query(
      `SELECT f_symbol AS symbol, f_currency AS currency, f_balance AS balance
       FROM t_insurance_fund ORDER BY f_symbol`,
      { type: QueryTypes.SELECT },
    );
  }
}

export class AdlService {
  /** 穿仓后按盈利排名自动减仓 */
  static async runAdl(symbol: string, bankruptcyLoss: number): Promise<number> {
    const sequelize = await getSequelize();
    if (!sequelize || bankruptcyLoss <= 0) return 0;

    const covered = await InsuranceFundService.debit(symbol, "USDT", bankruptcyLoss);
    const remain = roundAmount(bankruptcyLoss - covered);
    if (remain <= 0) return 0;

    const winners = await sequelize.query<{
      userId: number;
      side: string;
      quantity: string;
      upnl: string;
      id: number;
    }>(
      `SELECT f_id AS id, f_user_id AS userId, f_side AS side, f_quantity AS quantity,
              f_unrealized_pnl AS upnl
       FROM t_futures_position
       WHERE f_symbol = :symbol AND f_status = 'open' AND f_unrealized_pnl > 0
       ORDER BY f_unrealized_pnl DESC LIMIT 10`,
      { replacements: { symbol }, type: QueryTypes.SELECT },
    );

    let adlCount = 0;
    let left = remain;
    const mark = await FuturesEngineService.getMarkPrice(symbol);

    for (const w of winners) {
      if (left <= 0) break;
      const qty = roundAmount(Math.min(Number(w.quantity), left / mark));
      if (qty <= 0) continue;

      try {
        await AccountService.runInTransaction(async (tx) => {
          await sequelize.query(
            `UPDATE t_futures_position SET f_quantity = f_quantity - :qty
             WHERE f_id = :id`,
            { replacements: { qty, id: w.id }, transaction: tx },
          );
          await sequelize.query(
            `INSERT INTO t_adl_event (f_user_id, f_symbol, f_side, f_quantity, f_price, f_reason)
             VALUES (:userId, :symbol, :side, :qty, :mark, 'adl')`,
            {
              replacements: {
                userId: w.userId,
                symbol,
                side: w.side,
                qty,
                mark,
              },
              transaction: tx,
            },
          );
        });
        await NotificationService.create(w.userId, {
          type: "risk",
          title: "ADL 自动减仓",
          body: `${symbol} 仓位被自动减仓 ${qty} 张`,
          refId: String(w.id),
        });
        left = roundAmount(left - qty * mark);
        adlCount += 1;
      } catch {
        /* continue */
      }
    }
    return adlCount;
  }
}

/** 全仓强平：账户权益低于维持保证金 */
export async function checkCrossLiquidations(): Promise<number> {
  const sequelize = await getSequelize();
  if (!sequelize) return 0;

  const users = await sequelize.query<{ userId: number }>(
    `SELECT DISTINCT f_user_id AS userId FROM t_futures_position
     WHERE f_status = 'open' AND f_margin_mode = 'cross'`,
    { type: QueryTypes.SELECT },
  );

  let liquidated = 0;
  for (const { userId } of users) {
    const positions = await sequelize.query<{
      id: number;
      symbol: string;
      side: string;
      quantity: string;
      upnl: string;
      entryPrice: string;
      leverage: number;
    }>(
      `SELECT f_id AS id, f_symbol AS symbol, f_side AS side, f_quantity AS quantity,
              f_unrealized_pnl AS upnl, f_entry_price AS entryPrice, f_leverage AS leverage
       FROM t_futures_position WHERE f_user_id = :userId AND f_status = 'open' AND f_margin_mode = 'cross'`,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
    if (positions.length === 0) continue;

    const futuresBal = await AccountService.getAvailable(userId, "USDT", undefined, "futures");
    const upnl = positions.reduce((s, p) => s + Number(p.upnl), 0);
    const equity = roundAmount(futuresBal + upnl);

    let maintenance = 0;
    for (const p of positions) {
      const mark = await FuturesEngineService.getMarkPrice(p.symbol);
      maintenance += (mark * Number(p.quantity)) / p.leverage * 0.5;
    }
    maintenance = roundAmount(maintenance);

    if (equity >= maintenance) continue;

    const worst = [...positions].sort((a, b) => Number(a.upnl) - Number(b.upnl))[0];
    if (!worst) continue;

    const mark = await FuturesEngineService.getMarkPrice(worst.symbol);
    try {
      await FuturesEngineService.checkLiquidations();
      liquidated += 1;
      void worst;
      void mark;
    } catch {
      /* fallback to per-position liq */
    }
  }
  return liquidated;
}

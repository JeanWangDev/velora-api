import { QueryTypes } from "sequelize";
import { getSequelize } from "@/db/connection";
import { BadRequestError } from "@/errors/app-error";
import { AccountService, roundAmount } from "@/services/account/account.service";
import { SpotSymbolService } from "@/services/spot/spot-symbol.service";

function genNo(prefix: string) {
  return `${prefix}${Date.now().toString(36)}`.toUpperCase();
}

/** 简化 Black-Scholes 欧式期权标记价 */
function optionMark(underlying: number, strike: number, iv: number, type: "call" | "put"): number {
  const t = 30 / 365;
  const d1 = (Math.log(underlying / strike) + 0.5 * iv * iv * t) / (iv * Math.sqrt(t));
  const nd1 = 0.5 * (1 + Math.tanh(d1 * 0.7978845608));
  if (type === "call") return roundAmount(Math.max(0.0001, underlying * nd1 - strike * (nd1 - 0.5)));
  return roundAmount(Math.max(0.0001, strike * (0.5 - nd1) - underlying * (1 - nd1)));
}

export class OptionService {
  static async listInstruments() {
    const sequelize = await getSequelize();
    if (!sequelize) return [];
    const rows = await sequelize.query<{
      symbol: string;
      underlying: string;
      strike: string;
      expiry: string;
      optionType: string;
      iv: string;
    }>(
      `SELECT f_symbol AS symbol, f_underlying AS underlying, f_strike AS strike,
              f_expiry AS expiry, f_option_type AS optionType, f_iv AS iv
       FROM t_option_instrument WHERE f_status = 'trading' ORDER BY f_expiry, f_strike`,
      { type: QueryTypes.SELECT },
    );

    const result = [];
    for (const r of rows) {
      const spot = await SpotSymbolService.getLastPrice(`${r.underlying}-USDT`);
      const mark = optionMark(spot, Number(r.strike), Number(r.iv), r.optionType as "call" | "put");
      result.push({ ...r, spot, mark, strike: Number(r.strike), iv: Number(r.iv) });
    }
    return result;
  }

  static async placeOrder(input: {
    userId: number;
    symbol: string;
    side: "buy" | "sell";
    quantity: number;
  }) {
    const sequelize = await getSequelize();
    if (!sequelize) throw new BadRequestError("数据库未启用");
    const qty = roundAmount(input.quantity);
    if (!(qty > 0)) throw new BadRequestError("数量无效");

    const inst = await sequelize.query<{
      underlying: string;
      strike: string;
      optionType: string;
      iv: string;
    }>(
      `SELECT f_underlying AS underlying, f_strike AS strike, f_option_type AS optionType, f_iv AS iv
       FROM t_option_instrument WHERE f_symbol = :symbol AND f_status = 'trading' LIMIT 1`,
      { replacements: { symbol: input.symbol }, type: QueryTypes.SELECT },
    );
    const row = inst[0];
    if (!row) throw new BadRequestError("期权不存在");

    const spot = await SpotSymbolService.getLastPrice(`${row.underlying}-USDT`);
    const premium = optionMark(spot, Number(row.strike), Number(row.iv), row.optionType as "call" | "put");
    const cost = roundAmount(premium * qty);

    if (input.side === "buy") {
      await AccountService.runInTransaction(async (tx) => {
        const avail = await AccountService.getAvailable(input.userId, "USDT", tx, "trading");
        if (avail < cost) throw new BadRequestError("USDT 余额不足");
        await AccountService.adjust(
          {
            userId: input.userId,
            currency: "USDT",
            accountType: "trading",
            availableDelta: -cost,
            ledgerType: "trade",
            ledgerAmount: -cost,
            refId: genNo("OP"),
          },
          tx,
        );
        await sequelize.query(
          `INSERT INTO t_option_position (f_user_id, f_symbol, f_side, f_quantity, f_avg_premium)
           VALUES (:userId, :symbol, 'long', :qty, :premium)`,
          {
            replacements: { userId: input.userId, symbol: input.symbol, qty, premium },
            transaction: tx,
          },
        );
      });
    } else {
      const pos = await sequelize.query<{ quantity: string }>(
        `SELECT f_quantity AS quantity FROM t_option_position
         WHERE f_user_id = :userId AND f_symbol = :symbol AND f_status = 'open' LIMIT 1`,
        { replacements: { userId: input.userId, symbol: input.symbol }, type: QueryTypes.SELECT },
      );
      if (!pos[0] || Number(pos[0].quantity) < qty) {
        throw new BadRequestError("期权持仓不足");
      }
      await AccountService.runInTransaction(async (tx) => {
        await AccountService.adjust(
          {
            userId: input.userId,
            currency: "USDT",
            accountType: "trading",
            availableDelta: cost,
            ledgerType: "trade",
            ledgerAmount: cost,
            refId: genNo("OP"),
          },
          tx,
        );
        await sequelize.query(
          `UPDATE t_option_position SET f_quantity = f_quantity - :qty
           WHERE f_user_id = :userId AND f_symbol = :symbol`,
          {
            replacements: { qty, userId: input.userId, symbol: input.symbol },
            transaction: tx,
          },
        );
      });
    }
    return { premium, cost, quantity: qty };
  }

  static async listPositions(userId: number) {
    const sequelize = await getSequelize();
    if (!sequelize) return [];
    return sequelize.query(
      `SELECT f_symbol AS symbol, f_side AS side, f_quantity AS quantity,
              f_avg_premium AS avgPremium, f_status AS status
       FROM t_option_position WHERE f_user_id = :userId AND f_quantity > 0`,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
  }

  /** 到期现金结算 */
  static async settleExpired(): Promise<number> {
    const sequelize = await getSequelize();
    if (!sequelize) return 0;

    const expired = await sequelize.query<{
      userId: number;
      symbol: string;
      quantity: string;
      underlying: string;
      strike: string;
      optionType: string;
    }>(
      `SELECT p.f_user_id AS userId, p.f_symbol AS symbol, p.f_quantity AS quantity,
              i.f_underlying AS underlying, i.f_strike AS strike, i.f_option_type AS optionType
       FROM t_option_position p
       JOIN t_option_instrument i ON i.f_symbol = p.f_symbol
       WHERE p.f_quantity > 0 AND i.f_expiry <= CURDATE()`,
      { type: QueryTypes.SELECT },
    );

    let count = 0;
    for (const pos of expired) {
      const spot = await SpotSymbolService.getLastPrice(`${pos.underlying}-USDT`);
      const strike = Number(pos.strike);
      const qty = Number(pos.quantity);
      let payout = 0;
      if (pos.optionType === "call" && spot > strike) payout = (spot - strike) * qty;
      if (pos.optionType === "put" && spot < strike) payout = (strike - spot) * qty;
      payout = roundAmount(payout);
      if (payout > 0) {
        await AccountService.runInTransaction(async (tx) => {
          await AccountService.adjust(
            {
              userId: pos.userId,
              currency: "USDT",
              accountType: "trading",
              availableDelta: payout,
              ledgerType: "credit",
              ledgerAmount: payout,
              refId: genNo("OS"),
            },
            tx,
          );
        });
      }
      await sequelize.query(
        `UPDATE t_option_position SET f_quantity = 0, f_status = 'settled' WHERE f_user_id = :userId AND f_symbol = :symbol`,
        { replacements: { userId: pos.userId, symbol: pos.symbol } },
      );
      count += 1;
    }
    return count;
  }
}

export class QuickBuyService {
  static async createQuote(fiatAmount: number, crypto = "USDT", rate = 7.2) {
    const cryptoAmount = roundAmount(fiatAmount / rate);
    return { fiatAmount, crypto, cryptoAmount, rate, channel: "mock_bank" };
  }

  static async createOrder(userId: number, fiatAmount: number, crypto = "USDT") {
    const sequelize = await getSequelize();
    if (!sequelize) throw new BadRequestError("数据库未启用");
    const rate = 7.2;
    const cryptoAmount = roundAmount(fiatAmount / rate);
    const orderNo = genNo("QB");

    await sequelize.query(
      `INSERT INTO t_quick_buy_order
        (f_order_no, f_user_id, f_fiat_amount, f_crypto_currency, f_crypto_amount, f_rate)
       VALUES (:orderNo, :userId, :fiatAmount, :crypto, :cryptoAmount, :rate)`,
      { replacements: { orderNo, userId, fiatAmount, crypto, cryptoAmount, rate } },
    );
    return { orderNo, fiatAmount, cryptoAmount, status: "pending" };
  }

  static async confirmPayment(userId: number, orderNo: string) {
    const sequelize = await getSequelize();
    if (!sequelize) throw new BadRequestError("数据库未启用");

    const rows = await sequelize.query<{ cryptoAmount: string; crypto: string; status: string }>(
      `SELECT f_crypto_amount AS cryptoAmount, f_crypto_currency AS crypto, f_status AS status
       FROM t_quick_buy_order WHERE f_order_no = :orderNo AND f_user_id = :userId LIMIT 1`,
      { replacements: { orderNo, userId }, type: QueryTypes.SELECT },
    );
    const order = rows[0];
    if (!order || order.status !== "pending") throw new BadRequestError("订单无效");

    const amount = Number(order.cryptoAmount);
    await AccountService.runInTransaction(async (tx) => {
      await AccountService.adjust(
        {
          userId,
          currency: order.crypto,
          accountType: "funding",
          availableDelta: amount,
          ledgerType: "deposit",
          ledgerAmount: amount,
          refId: orderNo,
        },
        tx,
      );
      await sequelize.query(
        `UPDATE t_quick_buy_order SET f_status = 'completed' WHERE f_order_no = :orderNo`,
        { replacements: { orderNo }, transaction: tx },
      );
    });
    return { credited: amount, currency: order.crypto };
  }

  static async listOrders(userId: number) {
    const sequelize = await getSequelize();
    if (!sequelize) return [];
    return sequelize.query(
      `SELECT f_order_no AS orderNo, f_fiat_amount AS fiatAmount, f_crypto_currency AS crypto,
              f_crypto_amount AS cryptoAmount, f_status AS status,
              UNIX_TIMESTAMP(f_create_time)*1000 AS ts
       FROM t_quick_buy_order WHERE f_user_id = :userId ORDER BY f_id DESC LIMIT 50`,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
  }
}

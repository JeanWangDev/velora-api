/**
 * 清空业务数据（yarn db:clear）
 * - 默认仅清空 KYC，便于重新走 Didit 验证
 * - --all 清空用户/订单/策略等业务表，保留角色、币对、会员计划等种子数据
 */
import path from "path";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

const root = process.cwd();
const env = process.env.NODE_ENV || "development";
const clearAll = process.argv.includes("--all");

dotenv.config({ path: path.resolve(root, `.env.${env}`) });

const host = process.env.DB_HOST ?? "";
const port = Number(process.env.DB_PORT ?? "4000");
const user = process.env.DB_USER ?? "";
const password = process.env.DB_PASSWORD ?? "";
const sslEnabled = process.env.DB_SSL !== "false";

/** 仅 KYC 重测 */
const kycTables = ["t_kyc_verification"];

/** 全量业务数据（子表在前，保留 t_role / t_trading_symbol / t_membership_plan 等种子） */
const allDataTables = [
  "t_copy_order_log",
  "t_copy_subscription",
  "t_exchange_connection",
  "t_creator_withdrawal",
  "t_creator_ledger",
  "t_creator_balance",
  "t_strategy_paper_trade",
  "t_strategy_paper_state",
  "t_strategy_follow",
  "t_strategy",
  "t_chart_template_usage",
  "t_chart_template",
  "t_payment_order",
  "t_user_subscription",
  "t_payment_address_index",
  "t_email_verification",
  "t_kyc_verification",
  "t_user_reset_token",
  "t_user_password_history",
  "t_user_role",
  "t_user",
  "t_event",
];

async function main() {
  const tables = clearAll ? allDataTables : kycTables;
  const connection = await mysql.createConnection({
    host,
    port,
    user,
    password,
    multipleStatements: true,
    charset: "utf8mb4",
    ...(sslEnabled
      ? { ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true } }
      : {}),
  });

  try {
    console.log(`[db:clear] ${host}:${port} mode=${clearAll ? "all" : "kyc"}`);
    await connection.query("USE `velora`");
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of tables) {
      await connection.query(`TRUNCATE TABLE \`${table}\``);
      console.log(`[db:clear] truncated ${table}`);
    }
    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    console.log("[db:clear] done");
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error("[db:clear]", err.message ?? err);
  process.exit(1);
});

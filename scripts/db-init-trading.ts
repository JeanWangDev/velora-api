/**
 * 仅初始化现货交易相关表（account + spot），不跑全量 db:init
 * yarn db:init:trading
 */
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

const root = process.cwd();
const env = process.env.NODE_ENV || "development";

dotenv.config({ path: path.resolve(root, `.env.${env}`) });

const sqlFiles = ["scripts/sql/account.sql", "scripts/sql/trading.sql", "scripts/sql/admin-finance.sql"];

async function main() {
  const sslEnabled = process.env.DB_SSL !== "false";
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST ?? "",
    port: Number(process.env.DB_PORT ?? "4000"),
    user: process.env.DB_USER ?? "",
    password: process.env.DB_PASSWORD ?? "",
    multipleStatements: true,
    charset: "utf8mb4",
    ...(sslEnabled
      ? { ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true } }
      : {}),
  });

  try {
    console.log(`[db:init:trading] ${process.env.DB_HOST}:${process.env.DB_PORT}`);
    for (const file of sqlFiles) {
      const sql = fs.readFileSync(path.resolve(root, file), "utf8");
      await connection.query(sql);
      console.log(`[db:init:trading] ${file}`);
    }
    console.log("[db:init:trading] done");
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error("[db:init:trading]", err.message ?? err);
  process.exit(1);
});

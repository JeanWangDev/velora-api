/**
 * 手动从 Didit 同步 KYC 结果：yarn tsx scripts/sync-didit-kyc.ts [userId] [sessionId]
 */
import path from "path";
import dotenv from "dotenv";

const root = process.cwd();
const env = process.env.NODE_ENV || "development";
dotenv.config({ path: path.resolve(root, `.env.${env}`) });

async function main() {
  const { initDatabase } = await import("../src/db/connection");
  const { initModels } = await import("../src/db");
  const { KycService } = await import("../src/services/kyc/kyc.service");
  const { KycVerification } = await import("../src/db/models/kyc");

  await initDatabase();
  await initModels();

  const userIdArg = process.argv[2];
  const sessionArg = process.argv[3];

  if (userIdArg && sessionArg) {
    const row = await KycService.syncFromDiditSession(Number(userIdArg), sessionArg);
    console.log("[sync-didit]", row.userId, row.status, row.fullName, row.idNumber);
    return;
  }

  const rows = await KycVerification.findAll({
    where: { status: "pending" },
  });

  for (const row of rows) {
    if (!row.diditSessionId) continue;
    const synced = await KycService.syncFromDiditSession(row.userId, row.diditSessionId);
    console.log("[sync-didit]", synced.userId, synced.status, synced.fullName, synced.idNumber);
  }
}

main().catch((err) => {
  console.error("[sync-didit]", err.message ?? err);
  process.exit(1);
});

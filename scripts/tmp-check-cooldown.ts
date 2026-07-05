import "dotenv/config";
import { initDatabase } from "@/db/connection";
import { initModels } from "@/db";
import { EmailVerification } from "@/db";

async function main() {
  await initDatabase();
  await initModels();
  const rows = await EmailVerification.findAll({
    where: { email: "wangyongjian317@gmail.com" },
    order: [["createTime", "DESC"]],
    limit: 3,
    raw: true,
  });
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}
main();

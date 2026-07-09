import Router from "@koa/router";
import { AccountController } from "@/controllers/account";

const router = new Router({ prefix: "/account" });

router.get("/balances", AccountController.balances);
router.get("/ledger", AccountController.ledger);

export default router;

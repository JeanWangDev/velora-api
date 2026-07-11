import Router from "@koa/router";
import { WalletController } from "@/controllers/wallet/wallet.controller";

const router = new Router({ prefix: "/wallet" });

router.get("/deposit-address", WalletController.depositAddress);
router.post("/withdraw", WalletController.withdraw);
router.get("/deposits", WalletController.deposits);
router.get("/withdrawals", WalletController.withdrawals);
router.get("/transfers", WalletController.transfers);
router.get("/chains", WalletController.chains);
router.post("/transfer", WalletController.transfer);

export default router;

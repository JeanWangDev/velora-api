import Router from "@koa/router";
import { SpotController } from "@/controllers/spot";

const router = new Router({ prefix: "/spot" });

router.get("/symbols", SpotController.symbols);
router.post("/order", SpotController.placeOrder);
router.post("/order/cancel", SpotController.cancelOrder);
router.get("/orders/open", SpotController.openOrders);
router.get("/orders/history", SpotController.historyOrders);
router.get("/trades", SpotController.trades);

export default router;

import Router from "@koa/router";
import { KycController } from "@/controllers/kyc";

const router = new Router({ prefix: "/kyc" });

router.get("/me", KycController.me);
router.get("/config", KycController.config);
router.get("/didit/config", KycController.diditConfig);
router.post("/didit/session", KycController.diditCreateSession);
router.post("/didit/sync", KycController.diditSync);
router.post("/didit/webhook", KycController.diditWebhook);
router.post("/upload", KycController.upload);
router.post("/submit", KycController.submit);
router.get("/admin/list", KycController.adminList);
router.post("/review", KycController.review);

export default router;

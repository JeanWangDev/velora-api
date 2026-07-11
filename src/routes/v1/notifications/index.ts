import Router from "@koa/router";
import { NotificationController } from "@/controllers/notification/notification.controller";

const router = new Router({ prefix: "/notifications" });

router.get("/", NotificationController.list);
router.post("/read", NotificationController.markRead);

export default router;

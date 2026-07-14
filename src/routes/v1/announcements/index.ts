import Router from "@koa/router";
import { AnnouncementController } from "@/controllers/announcement/announcement.controller";

const router = new Router({ prefix: "/announcements" });

router.get("/", AnnouncementController.list);
router.get("/:id", AnnouncementController.getById);

export default router;

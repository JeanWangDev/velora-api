import Router from "@koa/router";
import { AuthController } from "@/controllers/auth";

const router = new Router({ prefix: "/auth" });

router.get("/roles", AuthController.roles);
router.post("/send-code", AuthController.sendEmailCode);
router.post("/verify-code", AuthController.verifyEmailCode);
router.post("/register", AuthController.register);
router.post("/login", AuthController.login);
router.post("/login/totp", AuthController.loginTotp);
router.post("/login/challenge", AuthController.loginChallenge);
router.post("/login/verify", AuthController.loginVerify);
router.get("/login-history", AuthController.loginHistory);
router.get("/sessions", AuthController.listSessions);
router.post("/sessions/revoke", AuthController.revokeSession);
router.post("/sessions/revoke-all", AuthController.revokeAllSessions);
router.get("/2fa/status", AuthController.status2fa);
router.post("/2fa/setup", AuthController.setup2fa);
router.post("/2fa/verify", AuthController.verify2fa);
router.post("/2fa/disable", AuthController.disable2fa);
router.post("/change-password", AuthController.changePassword);
router.post("/forgot-password", AuthController.forgotPassword);
router.post("/reset-password", AuthController.resetPassword);
router.get("/me", AuthController.me);
router.post("/update-profile", AuthController.updateProfile);

export default router;

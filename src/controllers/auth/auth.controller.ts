import type { Context } from "koa";
import { toAuthSessionDto, toAuthUserDto } from "@/dto/auth";
import { BadRequestError } from "@/errors/app-error";
import { requireAuthUser } from "@/middlewares/auth.middleware";
import { AuthService } from "@/services/auth";
import {
  forgotPasswordBodySchema,
  loginBodySchema,
  loginTotpBodySchema,
  loginVerifyBodySchema,
  registerBodySchema,
  resetPasswordBodySchema,
  sendEmailCodeBodySchema,
  updateProfileBodySchema,
  validateBody,
  verifyEmailCodeBodySchema,
} from "@/validators";
import { loginMetaFromCtx } from "@/utils/client-meta";
import { SessionService } from "@/services/auth/session.service";
import { SecurityController } from "./security.controller";

export class AuthController {
  static async roles(ctx: Context) {
    const roles = await AuthService.listRoles();
    ctx.sendSuccess(roles);
  }

  static async sendEmailCode(ctx: Context) {
    const body = validateBody(sendEmailCodeBodySchema, ctx.request.body);
    const result = await AuthService.sendEmailCode(body);
    ctx.sendSuccess(result);
  }

  static async verifyEmailCode(ctx: Context) {
    const body = validateBody(verifyEmailCodeBodySchema, ctx.request.body);
    const result = await AuthService.verifyEmailCode(body);
    ctx.sendSuccess(result);
  }

  static async register(ctx: Context) {
    const body = validateBody(registerBodySchema, ctx.request.body);
    const session = await AuthService.register(body);
    ctx.sendSuccess(toAuthSessionDto(session));
  }

  static async login(ctx: Context) {
    const body = validateBody(loginBodySchema, ctx.request.body);
    const result = await AuthService.login(body, loginMetaFromCtx(ctx));
    if (!("accessToken" in result)) {
      ctx.sendSuccess(result);
      return;
    }
    ctx.sendSuccess(toAuthSessionDto(result));
  }

  static async loginTotp(ctx: Context) {
    const body = validateBody(loginTotpBodySchema, ctx.request.body);
    const session = await AuthService.loginTotp(
      body.totpToken,
      body.code,
      loginMetaFromCtx(ctx),
    );
    ctx.sendSuccess(toAuthSessionDto(session));
  }

  static async loginChallenge(ctx: Context) {
    const body = validateBody(loginBodySchema, ctx.request.body);
    const result = await AuthService.loginChallenge(body);
    ctx.sendSuccess(result);
  }

  static async loginVerify(ctx: Context) {
    const body = validateBody(loginVerifyBodySchema, ctx.request.body);
    const session = await AuthService.loginVerify(body, loginMetaFromCtx(ctx));
    ctx.sendSuccess(toAuthSessionDto(session));
  }

  static async forgotPassword(ctx: Context) {
    const body = validateBody(forgotPasswordBodySchema, ctx.request.body);
    const result = await AuthService.forgotPassword(body);
    ctx.sendSuccess(result);
  }

  static async resetPassword(ctx: Context) {
    const body = validateBody(resetPasswordBodySchema, ctx.request.body);
    const session = await AuthService.resetPassword(body);
    ctx.sendSuccess(toAuthSessionDto(session));
  }

  static async me(ctx: Context) {
    const authUser = requireAuthUser(ctx);
    const userId = Number(authUser.id);

    if (!Number.isFinite(userId)) {
      ctx.sendSuccess({ user: authUser });
      return;
    }

    const profile = await AuthService.getProfileById(userId);
    if (!profile) {
      ctx.sendSuccess({ user: authUser });
      return;
    }

    ctx.sendSuccess({ user: toAuthUserDto(profile) });
  }

  static async updateProfile(ctx: Context) {
    const authUser = requireAuthUser(ctx);
    const userId = Number(authUser.id);

    if (!Number.isFinite(userId)) {
      throw new BadRequestError("无效的用户身份");
    }

    const body = validateBody(updateProfileBodySchema, ctx.request.body);
    const profile = await AuthService.updateProfile(userId, body);
    ctx.sendSuccess({ user: toAuthUserDto(profile) });
  }

  static status2fa = SecurityController.status2fa;
  static setup2fa = SecurityController.setup2fa;
  static verify2fa = SecurityController.verify2fa;
  static disable2fa = SecurityController.disable2fa;
  static changePassword = SecurityController.changePassword;
  static loginHistory = SecurityController.loginHistory;

  static async listSessions(ctx: Context) {
    const authUser = requireAuthUser(ctx);
    const rows = await SessionService.listActive(Number(authUser.id));
    ctx.sendSuccess({ rows });
  }

  static async revokeSession(ctx: Context) {
    const authUser = requireAuthUser(ctx);
    const id = Number((ctx.request.body as { id?: number })?.id);
    if (!Number.isFinite(id)) throw new BadRequestError("缺少会话 id");
    const result = await SessionService.revoke(Number(authUser.id), id);
    ctx.sendSuccess(result);
  }

  static async revokeAllSessions(ctx: Context) {
    const authUser = requireAuthUser(ctx);
    const result = await SessionService.revokeAll(Number(authUser.id));
    ctx.sendSuccess(result);
  }
}

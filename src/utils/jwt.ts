import jwt, { type SignOptions } from "jsonwebtoken";
import { config } from "@/config";
import { UnauthorizedError } from "@/errors/app-error";
import type { AuthUser, JwtAccessPayload } from "@/types/auth";

const ACCESS_TOKEN_ALGORITHM = "HS256";

function mapPayload(payload: jwt.JwtPayload & Partial<JwtAccessPayload>): AuthUser {
  const id = payload.sub;
  if (!id) {
    throw new UnauthorizedError("无效的访问令牌");
  }

  return {
    id: String(id),
    email: typeof payload.email === "string" ? payload.email : undefined,
    nickname: typeof payload.nickname === "string" ? payload.nickname : undefined,
    roleKey: typeof payload.roleKey === "string" ? payload.roleKey : undefined,
    roleLevel:
      typeof payload.roleLevel === "number" ? payload.roleLevel : undefined,
  };
}

/** Verify a Bearer access token and return the authenticated user. */
export function verifyAccessToken(token: string): AuthUser {
  if (!config.jwtSecret) {
    throw new UnauthorizedError("服务端鉴权未配置");
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret, {
      algorithms: [ACCESS_TOKEN_ALGORITHM],
    });

    if (typeof payload === "string" || !payload) {
      throw new UnauthorizedError("无效的访问令牌");
    }

    return mapPayload(payload);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }

    if (error instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError("登录已过期，请重新登录");
    }

    if (error instanceof jwt.JsonWebTokenError) {
      throw new UnauthorizedError("无效的访问令牌");
    }

    throw error;
  }
}

export function decodeAccessTokenUnsafe(token: string): AuthUser | null {
  const payload = jwt.decode(token);

  if (typeof payload === "string" || !payload || !payload.sub) {
    return null;
  }

  return mapPayload(payload);
}

export function signAccessToken(
  user: AuthUser,
  expiresIn?: string,
): { accessToken: string; expiresAt: number } {
  if (!config.jwtSecret) {
    throw new UnauthorizedError("服务端鉴权未配置");
  }

  const resolvedExpiresIn = expiresIn ?? config.jwtExpiresIn;
  const accessToken = jwt.sign(
    {
      sub: user.id,
      email: user.email,
      nickname: user.nickname,
      roleKey: user.roleKey,
      roleLevel: user.roleLevel,
    } satisfies JwtAccessPayload,
    config.jwtSecret,
    {
      algorithm: ACCESS_TOKEN_ALGORITHM,
      expiresIn: resolvedExpiresIn,
    } as SignOptions,
  );

  const decoded = jwt.decode(accessToken);
  const exp =
    decoded && typeof decoded === "object" && typeof decoded.exp === "number"
      ? decoded.exp
      : Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

  return { accessToken, expiresAt: exp * 1000 };
}

const LOGIN_CHALLENGE_EXPIRES_IN = "5m";

export function signLoginChallenge(userId: number, email: string): string {
  if (!config.jwtSecret) {
    throw new UnauthorizedError("服务端鉴权未配置");
  }

  return jwt.sign(
    { typ: "login_challenge", email },
    config.jwtSecret,
    {
      algorithm: ACCESS_TOKEN_ALGORITHM,
      subject: String(userId),
      expiresIn: LOGIN_CHALLENGE_EXPIRES_IN,
    } as SignOptions,
  );
}

export function verifyLoginChallenge(token: string): { userId: number; email: string } {
  if (!config.jwtSecret) {
    throw new UnauthorizedError("服务端鉴权未配置");
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret, {
      algorithms: [ACCESS_TOKEN_ALGORITHM],
    });

    if (typeof payload === "string" || !payload || !payload.sub) {
      throw new UnauthorizedError("登录验证已失效，请重新登录");
    }

    if (payload.typ !== "login_challenge") {
      throw new UnauthorizedError("登录验证已失效，请重新登录");
    }

    const userId = Number(payload.sub);
    const email = typeof payload.email === "string" ? payload.email : "";

    if (!Number.isFinite(userId) || userId <= 0 || !email) {
      throw new UnauthorizedError("登录验证已失效，请重新登录");
    }

    return { userId, email };
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    if (error instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError("登录验证已过期，请重新登录");
    }
    throw new UnauthorizedError("登录验证已失效，请重新登录");
  }
}

export function signTotpChallenge(userId: number): string {
  if (!config.jwtSecret) {
    throw new UnauthorizedError("服务端鉴权未配置");
  }

  return jwt.sign(
    { typ: "totp_challenge" },
    config.jwtSecret,
    {
      algorithm: ACCESS_TOKEN_ALGORITHM,
      subject: String(userId),
      expiresIn: LOGIN_CHALLENGE_EXPIRES_IN,
    } as SignOptions,
  );
}

export function verifyTotpChallenge(token: string): number {
  if (!config.jwtSecret) {
    throw new UnauthorizedError("服务端鉴权未配置");
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret, {
      algorithms: [ACCESS_TOKEN_ALGORITHM],
    });

    if (typeof payload === "string" || !payload || !payload.sub) {
      throw new UnauthorizedError("验证已失效，请重新登录");
    }

    if (payload.typ !== "totp_challenge") {
      throw new UnauthorizedError("验证已失效，请重新登录");
    }

    const userId = Number(payload.sub);
    if (!Number.isFinite(userId) || userId <= 0) {
      throw new UnauthorizedError("验证已失效，请重新登录");
    }

    return userId;
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    if (error instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError("验证已过期，请重新登录");
    }
    throw new UnauthorizedError("验证已失效，请重新登录");
  }
}

import { randomUUID } from "node:crypto";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import { redisClient } from "../../config/redis.js";
import { env } from "../../config/env.js";
import { authRepository } from "./auth.repository.js";
import { hashPassword, isLegacyPasswordHash, verifyPassword } from "./password.js";
import type { LoginInput, RegisterInput } from "./auth.validation.js";

export const SESSION_TTL_SECONDS = 60 * 60 * 12;
export const JWT_ISSUER = "real-time-pricing-engine";
export const JWT_AUDIENCE = "pricing-engine-api";

export class AuthServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "AuthServiceError";
  }
}

export interface AccessTokenClaims extends JwtPayload {
  sub: string;
  jti: string;
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const payload = jwt.verify(token, env.JWT_SECRET, {
    algorithms: ["HS256"],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });

  if (
    typeof payload === "string" ||
    typeof payload.sub !== "string" ||
    typeof payload.jti !== "string" ||
    typeof payload.exp !== "number"
  ) {
    throw new AuthServiceError("Invalid access token", 401, "TOKEN_INVALID");
  }

  return payload as AccessTokenClaims;
}

export const authService = {
  async register(input: RegisterInput) {
    try {
      return await authRepository.createMerchant(input.email, await hashPassword(input.password));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AuthServiceError("An account with this email already exists", 409, "EMAIL_IN_USE");
      }
      throw error;
    }
  },

  async login(input: LoginInput) {
    const merchant = await authRepository.findByEmail(input.email);
    if (!merchant || !(await verifyPassword(input.password, merchant.passwordHash))) {
      throw new AuthServiceError("Invalid email or password", 401, "INVALID_CREDENTIALS");
    }
    if (merchant.accountStatus !== "ACTIVE") {
      throw new AuthServiceError("Account is suspended", 403, "ACCOUNT_SUSPENDED");
    }

    // Upgrade accounts created with the former scrypt implementation after a successful login.
    if (isLegacyPasswordHash(merchant.passwordHash)) {
      await authRepository.updatePasswordHash(merchant.id, await hashPassword(input.password));
    }

    const jti = randomUUID();
    const token = jwt.sign({ jti }, env.JWT_SECRET, {
      algorithm: "HS256",
      subject: merchant.id,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      expiresIn: SESSION_TTL_SECONDS,
    });

    return { merchant, token };
  },

  async logout(token: string): Promise<void> {
    const claims = verifyAccessToken(token);
    const remainingSeconds = claims.exp! - Math.floor(Date.now() / 1000);
    if (remainingSeconds <= 0) return;

    await redisClient.set(`auth:revoked:${claims.jti}`, "1", { EX: remainingSeconds });
  },
};

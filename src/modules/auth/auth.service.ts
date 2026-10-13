import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { redisClient } from "../../config/redis.js";
import { authRepository } from "./auth.repository.js";
import { hashPassword, verifyPassword } from "./password.js";
import { hashSessionToken } from "./session-token.js";
import type { LoginInput, RegisterInput } from "./auth.validation.js";

export const SESSION_TTL_SECONDS = 60 * 60 * 12;

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

    const token = randomBytes(32).toString("base64url");
    await redisClient.set(`auth:session:${hashSessionToken(token)}`, merchant.id, {
      EX: SESSION_TTL_SECONDS,
    });
    return { merchant, token };
  },

  async logout(token: string): Promise<void> {
    await redisClient.del(`auth:session:${hashSessionToken(token)}`);
  },
};

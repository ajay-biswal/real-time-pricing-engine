import type { NextFunction, Request, Response } from "express";
import { redisClient } from "../../config/redis.js";
import { prisma } from "../../config/prisma.js";
import type { MerchantRecord, MerchantRole } from "./auth.types.js";
import { hashSessionToken } from "./session-token.js";

export { hashSessionToken } from "./session-token.js";

declare global {
  namespace Express {
    interface Request {
      merchant?: MerchantRecord;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authorization = req.header("authorization");
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]) {
      res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
      return;
    }

    const sessionKey = `auth:session:${hashSessionToken(match[1])}`;
    const merchantId = await redisClient.get(sessionKey);
    if (!merchantId) {
      res.status(401).json({ error: "Session is invalid or expired", code: "SESSION_INVALID" });
      return;
    }

    const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
    if (!merchant) {
      await redisClient.del(sessionKey);
      res.status(401).json({ error: "Account no longer exists", code: "ACCOUNT_NOT_FOUND" });
      return;
    }
    if (merchant.accountStatus !== "ACTIVE") {
      await redisClient.del(sessionKey);
      res.status(403).json({ error: "Account is suspended", code: "ACCOUNT_SUSPENDED" });
      return;
    }

    req.merchant = merchant;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(...allowedRoles: MerchantRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.merchant) {
      res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
      return;
    }
    if (!allowedRoles.includes(req.merchant.role)) {
      res.status(403).json({ error: "Insufficient permissions", code: "FORBIDDEN" });
      return;
    }
    next();
  };
}

export function requireVerifiedMerchant(req: Request, res: Response, next: NextFunction): void {
  if (!req.merchant) {
    res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
    return;
  }
  if (req.merchant.role !== "MERCHANT") {
    res.status(403).json({ error: "Insufficient permissions", code: "FORBIDDEN" });
    return;
  }
  if (req.merchant.kycStatus !== "VERIFIED") {
    res.status(403).json({
      error: "KYC verification is required before accessing trading functionality",
      code: "KYC_NOT_VERIFIED",
      kycStatus: req.merchant.kycStatus,
    });
    return;
  }
  next();
}

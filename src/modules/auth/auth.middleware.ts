import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { ObjectId } from "mongodb";
import { redisClient } from "../../config/redis.js";
import { getMongoDb } from "../../config/mongodb.js";
import type { MerchantRecord } from "./auth.types.js";

declare global {
  namespace Express {
    interface Request {
      merchant?: MerchantRecord;
    }
  }
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
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
    const userId = await redisClient.get(sessionKey);
    if (!userId || !ObjectId.isValid(userId)) {
      res.status(401).json({ error: "Session is invalid or expired", code: "SESSION_INVALID" });
      return;
    }

    const merchant = await getMongoDb().collection<MerchantRecord>("merchants").findOne({
      _id: new ObjectId(userId),
    });
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

export function requireVerifiedMerchant(req: Request, res: Response, next: NextFunction): void {
  if (!req.merchant) {
    res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
    return;
  }
  if (req.merchant.role !== "MERCHANT") {
    res.status(403).json({ error: "Insufficient permissions", code: "FORBIDDEN" });
    return;
  }
  if (req.merchant.kyc.status !== "VERIFIED") {
    res.status(403).json({
      error: "KYC verification is required before accessing trading functionality",
      code: "KYC_NOT_VERIFIED",
      kycStatus: req.merchant.kyc.status,
    });
    return;
  }
  next();
}

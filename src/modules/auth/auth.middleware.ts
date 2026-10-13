import type { NextFunction, Request, Response } from "express";
import { redisClient } from "../../config/redis.js";
import { authRepository } from "./auth.repository.js";
import type { MerchantRecord, MerchantRole } from "./auth.types.js";
import { AuthServiceError, verifyAccessToken } from "./auth.service.js";

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

    let claims;
    try {
      claims = verifyAccessToken(match[1]);
    } catch (error) {
      if (error instanceof AuthServiceError || error instanceof Error) {
        res.status(401).json({ error: "Access token is invalid or expired", code: "TOKEN_INVALID" });
        return;
      }
      throw error;
    }

    const revoked = await redisClient.exists(`auth:revoked:${claims.jti}`);
    if (revoked) {
      res.status(401).json({ error: "Access token has been revoked", code: "TOKEN_REVOKED" });
      return;
    }

    const merchant = await authRepository.findById(claims.sub);
    if (!merchant) {
      res.status(401).json({ error: "Account no longer exists", code: "ACCOUNT_NOT_FOUND" });
      return;
    }
    if (merchant.accountStatus !== "ACTIVE") {
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

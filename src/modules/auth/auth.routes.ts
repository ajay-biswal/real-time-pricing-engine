import { randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { redisClient } from "../../config/redis.js";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { hashPassword, verifyPassword } from "./password.js";
import { requireAuth, hashSessionToken } from "./auth.middleware.js";
import { toPublicMerchant } from "./auth.types.js";

export const authRouter = Router();
const SESSION_TTL_SECONDS = 60 * 60 * 12;

const registerSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
});
const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
});

async function rateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ip = req.ip ?? "unknown";
    const key = `auth:rate:${req.path}:${ip}`;
    const count = await redisClient.incr(key);
    if (count === 1) await redisClient.expire(key, 60);
    if (count > 20) {
      res.status(429).json({ error: "Too many authentication attempts; try again in a minute" });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}

authRouter.post("/register", rateLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid registration data", details: parsed.error.flatten() });
      return;
    }

    const merchant = await prisma.merchant.create({
      data: {
        email: parsed.data.email,
        passwordHash: await hashPassword(parsed.data.password),
        role: "MERCHANT",
        accountStatus: "ACTIVE",
        kycStatus: "NOT_SUBMITTED",
      },
    });

    res.status(201).json({
      message: "Merchant account created. Submit KYC before accessing trading functionality.",
      merchant: {
        id: merchant.id,
        email: merchant.email,
        role: merchant.role,
        accountStatus: merchant.accountStatus,
        kycStatus: merchant.kycStatus,
        createdAt: merchant.createdAt,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      res.status(409).json({ error: "An account with this email already exists", code: "EMAIL_IN_USE" });
      return;
    }
    next(error);
  }
});

authRouter.post("/login", rateLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid login data", details: parsed.error.flatten() });
      return;
    }

    const merchant = await prisma.merchant.findUnique({ where: { email: parsed.data.email } });
    if (!merchant || !(await verifyPassword(parsed.data.password, merchant.passwordHash))) {
      res.status(401).json({ error: "Invalid email or password", code: "INVALID_CREDENTIALS" });
      return;
    }
    if (merchant.accountStatus !== "ACTIVE") {
      res.status(403).json({ error: "Account is suspended", code: "ACCOUNT_SUSPENDED" });
      return;
    }

    const token = randomBytes(32).toString("base64url");
    await redisClient.set(`auth:session:${hashSessionToken(token)}`, merchant.id, {
      EX: SESSION_TTL_SECONDS,
    });

    res.status(200).json({
      message: "Login successful",
      accessToken: token,
      tokenType: "Bearer",
      expiresIn: SESSION_TTL_SECONDS,
      merchant: toPublicMerchant(merchant),
    });
  } catch (error) {
    next(error);
  }
});

authRouter.get("/me", requireAuth, (req: Request, res: Response) => {
  if (!req.merchant) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  res.json({ merchant: toPublicMerchant(req.merchant) });
});

authRouter.post("/logout", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authorization = req.header("authorization");
    const token = authorization?.replace(/^Bearer\s+/i, "");
    if (token) await redisClient.del(`auth:session:${hashSessionToken(token)}`);
    res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    next(error);
  }
});

// Development-only endpoint for Postman smoke tests. Production KYC decisions must
// come from an authenticated admin workflow or a verified KYC-provider webhook.
authRouter.patch("/admin/merchants/:merchantId/kyc", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (env.NODE_ENV === "production") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const configuredKey = env.ADMIN_API_KEY;
    const suppliedKey = req.header("x-admin-api-key") ?? "";
    const expected = Buffer.from(configuredKey);
    const supplied = Buffer.from(suppliedKey);
    if (!configuredKey || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      res.status(403).json({ error: "Admin authorization required" });
      return;
    }

    const merchantId = z.string().min(1).safeParse(req.params.merchantId);
    if (!merchantId.success) {
      res.status(400).json({ error: "Invalid merchant ID" });
      return;
    }
    const parsed = z.object({
      status: z.enum(["VERIFIED", "REJECTED"]),
      rejectionReason: z.string().trim().min(1).max(500).optional(),
      providerReference: z.string().trim().min(1).max(200).optional(),
    }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid KYC review payload", details: parsed.error.flatten() });
      return;
    }
    if (parsed.data.status === "REJECTED" && !parsed.data.rejectionReason) {
      res.status(400).json({ error: "rejectionReason is required when rejecting KYC" });
      return;
    }

    const result = await prisma.merchant.updateMany({
      where: { id: merchantId.data, kycStatus: "PENDING" },
      data: {
        kycStatus: parsed.data.status,
        kycVerifiedAt: parsed.data.status === "VERIFIED" ? new Date() : null,
        kycRejectionReason: parsed.data.status === "REJECTED" ? parsed.data.rejectionReason : null,
        kycProviderReference: parsed.data.providerReference ?? null,
      },
    });
    if (result.count === 0) {
      res.status(404).json({ error: "Pending KYC application not found" });
      return;
    }
    const merchant = await prisma.merchant.findUnique({ where: { id: merchantId.data } });
    if (!merchant) {
      res.status(404).json({ error: "Merchant not found" });
      return;
    }
    res.json({ message: "KYC review completed", merchant: toPublicMerchant(merchant) });
  } catch (error) {
    next(error);
  }
});

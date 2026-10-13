import { randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { redisClient } from "../../config/redis.js";
import { getMongoDb } from "../../config/mongodb.js";
import { env } from "../../config/env.js";
import { hashPassword, verifyPassword } from "./password.js";
import { requireAuth, hashSessionToken } from "./auth.middleware.js";
import { toPublicMerchant, type MerchantRecord } from "./auth.types.js";

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

    const collection = getMongoDb().collection<MerchantRecord>("merchants");
    const existing = await collection.findOne({ email: parsed.data.email }, { projection: { _id: 1 } });
    if (existing) {
      res.status(409).json({ error: "An account with this email already exists", code: "EMAIL_IN_USE" });
      return;
    }

    const now = new Date();
    const merchant: Omit<MerchantRecord, "_id"> = {
      email: parsed.data.email,
      passwordHash: await hashPassword(parsed.data.password),
      role: "MERCHANT",
      accountStatus: "ACTIVE",
      kyc: { status: "NOT_SUBMITTED", providerReference: null, verifiedAt: null, rejectionReason: null },
      createdAt: now,
      updatedAt: now,
    };
    const result = await collection.insertOne(merchant as MerchantRecord);
    res.status(201).json({
      message: "Merchant account created. Submit KYC before accessing trading functionality.",
      merchant: {
        id: result.insertedId.toHexString(),
        email: merchant.email,
        role: merchant.role,
        accountStatus: merchant.accountStatus,
        kyc: merchant.kyc,
        createdAt: now,
      },
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
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

    const merchant = await getMongoDb().collection<MerchantRecord>("merchants").findOne({
      email: parsed.data.email,
    });
    if (!merchant || !(await verifyPassword(parsed.data.password, merchant.passwordHash))) {
      res.status(401).json({ error: "Invalid email or password", code: "INVALID_CREDENTIALS" });
      return;
    }
    if (merchant.accountStatus !== "ACTIVE") {
      res.status(403).json({ error: "Account is suspended", code: "ACCOUNT_SUSPENDED" });
      return;
    }

    const token = randomBytes(32).toString("base64url");
    await redisClient.set(`auth:session:${hashSessionToken(token)}`, merchant._id.toHexString(), {
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

// Development-only endpoint to make Postman smoke tests possible without a real KYC vendor.
// In production, replace this with a signed webhook/provider verification workflow.
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
    if (!ObjectId.isValid(req.params.merchantId)) {
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

    const now = new Date();
    const update = await getMongoDb().collection<MerchantRecord>("merchants").findOneAndUpdate(
      { _id: new ObjectId(req.params.merchantId), "kyc.status": "PENDING" },
      {
        $set: {
          "kyc.status": parsed.data.status,
          "kyc.verifiedAt": parsed.data.status === "VERIFIED" ? now : null,
          "kyc.rejectionReason": parsed.data.status === "REJECTED" ? parsed.data.rejectionReason : null,
          "kyc.providerReference": parsed.data.providerReference ?? null,
          updatedAt: now,
        },
      },
      { returnDocument: "after", projection: { passwordHash: 0 } },
    );
    if (!update) {
      res.status(404).json({ error: "Pending KYC application not found" });
      return;
    }
    res.json({ message: "KYC review completed", merchant: update });
  } catch (error) {
    next(error);
  }
});

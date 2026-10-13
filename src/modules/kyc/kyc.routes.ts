import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { getMongoDb } from "../../config/mongodb.js";
import { requireAuth } from "../auth/auth.middleware.js";
import type { MerchantRecord } from "../auth/auth.types.js";

export const kycRouter = Router();

const kycSubmissionSchema = z.object({
  applicantName: z.string().trim().min(2).max(120),
  documentType: z.enum(["PASSPORT", "NATIONAL_ID", "DRIVING_LICENSE"]),
  providerReference: z.string().trim().min(1).max(200).optional(),
});

kycRouter.post("/submissions", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.merchant) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (req.merchant.kyc.status === "VERIFIED") {
      res.status(409).json({ error: "KYC is already verified" });
      return;
    }

    const parsed = kycSubmissionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid KYC submission", details: parsed.error.flatten() });
      return;
    }

    const now = new Date();
    const result = await getMongoDb().collection<MerchantRecord>("merchants").findOneAndUpdate(
      { _id: req.merchant._id, accountStatus: "ACTIVE" },
      {
        $set: {
          kyc: {
            status: "PENDING",
            applicantName: parsed.data.applicantName,
            documentType: parsed.data.documentType,
            providerReference: parsed.data.providerReference ?? null,
            submittedAt: now,
            verifiedAt: null,
            rejectionReason: null,
          },
          updatedAt: now,
        },
      },
      { returnDocument: "after", projection: { passwordHash: 0 } },
    );

    if (!result) {
      res.status(404).json({ error: "Merchant account not found" });
      return;
    }
    res.status(202).json({
      message: "KYC submission received. Trading remains disabled until verification succeeds.",
      merchant: result,
    });
  } catch (error) {
    next(error);
  }
});

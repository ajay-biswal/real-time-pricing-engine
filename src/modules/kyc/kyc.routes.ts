import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { toPublicMerchant } from "../auth/auth.types.js";

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
    if (req.merchant.kycStatus === "VERIFIED") {
      res.status(409).json({ error: "KYC is already verified" });
      return;
    }

    const parsed = kycSubmissionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid KYC submission", details: parsed.error.flatten() });
      return;
    }

    const merchant = await prisma.merchant.update({
      where: { id: req.merchant.id },
      data: {
        kycStatus: "PENDING",
        kycApplicantName: parsed.data.applicantName,
        kycDocumentType: parsed.data.documentType,
        kycProviderReference: parsed.data.providerReference ?? null,
        kycSubmittedAt: new Date(),
        kycVerifiedAt: null,
        kycRejectionReason: null,
      },
    });

    res.status(202).json({
      message: "KYC submission received. Trading remains disabled until verification succeeds.",
      merchant: toPublicMerchant(merchant),
    });
  } catch (error) {
    next(error);
  }
});

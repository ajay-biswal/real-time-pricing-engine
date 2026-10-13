import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { toPublicMerchant } from "../auth/auth.types.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { kycService, KycServiceError } from "./kyc.service.js";
import { kycReviewSchema, kycSubmissionSchema } from "./kyc.validation.js";

export const kycController = Router();

function handleError(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof KycServiceError) {
    res.status(error.statusCode).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
    return;
  }
  next(error);
}

kycController.post("/submissions", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  if (!req.merchant) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const parsed = kycSubmissionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid KYC submission", details: parsed.error.flatten() });
    return;
  }
  try {
    const merchant = await kycService.submit(req.merchant.id, req.merchant.kycStatus, parsed.data);
    res.status(202).json({
      message: "KYC submission received. Trading remains disabled until verification succeeds.",
      merchant: toPublicMerchant(merchant),
    });
  } catch (error) {
    handleError(error, res, next);
  }
});

kycController.patch("/admin/merchants/:merchantId/kyc", async (req: Request, res: Response, next: NextFunction) => {
  try {
    kycService.authorizeDevelopmentReview(req.header("x-admin-api-key") ?? "");
    const id = z.string().min(1).safeParse(req.params.merchantId);
    if (!id.success) {
      res.status(400).json({ error: "Invalid merchant ID" });
      return;
    }
    const parsed = kycReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid KYC review payload", details: parsed.error.flatten() });
      return;
    }
    const merchant = await kycService.review(id.data, parsed.data);
    res.json({ message: "KYC review completed", merchant: toPublicMerchant(merchant) });
  } catch (error) {
    handleError(error, res, next);
  }
});

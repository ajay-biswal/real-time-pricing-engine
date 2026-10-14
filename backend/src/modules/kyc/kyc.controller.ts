import { z } from "zod";
import type { NextFunction, Request, Response } from "express";
import { toPublicMerchant } from "../auth/auth.types.js";
import { kycRepository } from "./kyc.repository.js";
import { kycService, KycServiceError } from "./kyc.service.js";
import { kycReviewSchema, kycSubmissionSchema } from "./kyc.validation.js";

function handleError(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof KycServiceError) {
    res.status(error.statusCode).json({
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
    return;
  }
  next(error);
}

export async function listPendingKyc(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    kycService.authorizeDevelopmentReview(req.header("x-admin-api-key") ?? "");
    const submissions = await kycRepository.listPending();
    res.json({ submissions });
  } catch (error) {
    handleError(error, res, next);
  }
}

export async function submitKyc(req: Request, res: Response, next: NextFunction): Promise<void> {
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
}

export async function reviewKyc(req: Request, res: Response, next: NextFunction): Promise<void> {
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
}

import { timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";
import { kycRepository } from "./kyc.repository.js";
import type { KycReviewInput, KycSubmissionInput } from "./kyc.validation.js";

export class KycServiceError extends Error {
  constructor(message: string, public readonly statusCode: number, public readonly code?: string) {
    super(message);
    this.name = "KycServiceError";
  }
}

export const kycService = {
  async submit(merchantId: string, currentStatus: string, input: KycSubmissionInput) {
    if (currentStatus === "VERIFIED") {
      throw new KycServiceError("KYC is already verified", 409, "KYC_ALREADY_VERIFIED");
    }
    if (currentStatus === "PENDING") {
      throw new KycServiceError("A KYC application is already pending review", 409, "KYC_ALREADY_PENDING");
    }
    return kycRepository.submit(merchantId, input);
  },

  authorizeDevelopmentReview(suppliedKey: string): void {
    if (env.NODE_ENV === "production") {
      throw new KycServiceError("Not found", 404);
    }
    const configuredKey = env.ADMIN_API_KEY;
    const expected = Buffer.from(configuredKey);
    const supplied = Buffer.from(suppliedKey);
    if (!configuredKey || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw new KycServiceError("Admin authorization required", 403);
    }
  },

  async review(merchantId: string, input: KycReviewInput) {
    const merchant = await kycRepository.review(merchantId, input);
    if (!merchant) {
      throw new KycServiceError("Pending KYC application not found", 404);
    }
    return merchant;
  },
};

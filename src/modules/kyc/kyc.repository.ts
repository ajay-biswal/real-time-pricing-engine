import { prisma } from "../../config/prisma.js";
import type { KycSubmissionInput, KycReviewInput } from "./kyc.validation.js";

export const kycRepository = {
  listPending() {
    return prisma.merchant.findMany({
      where: { kycStatus: "PENDING" },
      orderBy: { kycSubmittedAt: "asc" },
      select: {
        id: true,
        email: true,
        kycApplicantName: true,
        kycDocumentType: true,
        kycProviderReference: true,
        kycSubmittedAt: true,
      },
    });
  },

  submit(merchantId: string, input: KycSubmissionInput) {
    return prisma.merchant.update({
      where: { id: merchantId },
      data: {
        kycStatus: "PENDING",
        kycApplicantName: input.applicantName,
        kycDocumentType: input.documentType,
        kycProviderReference: input.providerReference ?? null,
        kycSubmittedAt: new Date(),
        kycVerifiedAt: null,
        kycRejectionReason: null,
      },
    });
  },

  async review(merchantId: string, input: KycReviewInput) {
    const result = await prisma.merchant.updateMany({
      where: { id: merchantId, kycStatus: "PENDING" },
      data: {
        kycStatus: input.status,
        kycVerifiedAt: input.status === "VERIFIED" ? new Date() : null,
        kycRejectionReason: input.status === "REJECTED" ? input.rejectionReason : null,
        kycProviderReference: input.providerReference ?? undefined,
      },
    });
    if (result.count === 0) return null;
    return prisma.merchant.findUnique({ where: { id: merchantId } });
  },
};

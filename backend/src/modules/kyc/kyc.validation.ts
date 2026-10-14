import { z } from "zod";

export const kycSubmissionSchema = z.object({
  applicantName: z.string().trim().min(2).max(120),
  documentType: z.enum(["PASSPORT", "NATIONAL_ID", "DRIVING_LICENSE"]),
  providerReference: z.string().trim().min(1).max(200).optional(),
});

export const kycReviewSchema = z.object({
  status: z.enum(["VERIFIED", "REJECTED"]),
  rejectionReason: z.string().trim().min(1).max(500).optional(),
  providerReference: z.string().trim().min(1).max(200).optional(),
}).superRefine((value, context) => {
  if (value.status === "REJECTED" && !value.rejectionReason) {
    context.addIssue({
      code: "custom",
      path: ["rejectionReason"],
      message: "rejectionReason is required when rejecting KYC",
    });
  }
});

export type KycSubmissionInput = z.infer<typeof kycSubmissionSchema>;
export type KycReviewInput = z.infer<typeof kycReviewSchema>;

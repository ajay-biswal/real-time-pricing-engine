CREATE TYPE "MerchantRole" AS ENUM ('MERCHANT', 'ADMIN');
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "KycStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED');

CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "MerchantRole" NOT NULL DEFAULT 'MERCHANT',
    "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "kycApplicantName" VARCHAR(120),
    "kycDocumentType" VARCHAR(32),
    "kycProviderReference" VARCHAR(200),
    "kycSubmittedAt" TIMESTAMPTZ(3),
    "kycVerifiedAt" TIMESTAMPTZ(3),
    "kycRejectionReason" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Merchant_email_key" ON "Merchant"("email");
CREATE INDEX "Merchant_kycStatus_createdAt_idx" ON "Merchant"("kycStatus", "createdAt");

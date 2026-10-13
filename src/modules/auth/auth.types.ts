import type { ObjectId } from "mongodb";

export type MerchantRole = "MERCHANT";
export type AccountStatus = "ACTIVE" | "SUSPENDED";
export type KycStatus = "NOT_SUBMITTED" | "PENDING" | "VERIFIED" | "REJECTED";

export interface KycRecord {
  status: KycStatus;
  applicantName?: string;
  documentType?: "PASSPORT" | "NATIONAL_ID" | "DRIVING_LICENSE";
  providerReference?: string | null;
  submittedAt?: Date;
  verifiedAt?: Date | null;
  rejectionReason?: string | null;
}

export interface MerchantRecord {
  _id: ObjectId;
  email: string;
  passwordHash: string;
  role: MerchantRole;
  accountStatus: AccountStatus;
  kyc: KycRecord;
  createdAt: Date;
  updatedAt: Date;
}

export type PublicMerchant = Omit<MerchantRecord, "passwordHash">;

export function toPublicMerchant(merchant: MerchantRecord): PublicMerchant {
  const { passwordHash: _passwordHash, ...publicMerchant } = merchant;
  return publicMerchant;
}

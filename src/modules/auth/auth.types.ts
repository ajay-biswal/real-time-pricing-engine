import type { Merchant, MerchantRole } from "@prisma/client";

export type { AccountStatus, KycStatus, MerchantRole } from "@prisma/client";
export type MerchantRecord = Merchant;
export type PublicMerchant = Omit<MerchantRecord, "passwordHash">;

export function toPublicMerchant(merchant: MerchantRecord): PublicMerchant {
  const { passwordHash: _passwordHash, ...publicMerchant } = merchant;
  return publicMerchant;
}

export function hasMerchantRole(merchant: MerchantRecord, role: MerchantRole): boolean {
  return merchant.role === role;
}

export type MerchantRole = "MERCHANT" | "ADMIN";
export type AccountStatus = "ACTIVE" | "SUSPENDED";
export type KycStatus = "NOT_SUBMITTED" | "PENDING" | "VERIFIED" | "REJECTED";

export interface Merchant {
  id: string;
  email: string;
  role: MerchantRole;
  accountStatus: AccountStatus;
  kycStatus: KycStatus;
  kycApplicantName?: string | null;
  kycDocumentType?: string | null;
  kycProviderReference?: string | null;
  kycSubmittedAt?: string | null;
  kycVerifiedAt?: string | null;
  kycRejectionReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  merchant: Merchant;
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

export async function registerAccount(email: string, password: string): Promise<void> {
  await readJson(await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim().toLowerCase(), password })
  }));
}

export async function loginAccount(email: string, password: string): Promise<LoginResponse> {
  return readJson<LoginResponse>(await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim().toLowerCase(), password })
  }));
}

export async function getCurrentMerchant(token: string): Promise<Merchant> {
  const payload = await readJson<{ merchant: Merchant }>(await fetch("/api/auth/me", {
    headers: { Authorization: `Bearer ${token}` }
  }));
  return payload.merchant;
}

export async function logoutAccount(token: string): Promise<void> {
  await readJson(await fetch("/api/auth/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  }));
}

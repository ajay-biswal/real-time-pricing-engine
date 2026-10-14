import { useState, type FormEvent } from "react";
import { getCurrentMerchant, type Merchant } from "../../auth";

type Props = {
  merchant: Merchant;
  token: string;
  onMerchantUpdate: (merchant: Merchant) => void;
};

type ApiMessage = { error?: string; message?: string; merchant?: Merchant };

/** Account status, KYC metadata submission, status refresh, and trading-access check. */
export function AccountAccessPanel({ merchant, token, onMerchantUpdate }: Props) {
  const [kycName, setKycName] = useState(merchant.kycApplicantName || "");
  const [kycDocumentType, setKycDocumentType] = useState(merchant.kycDocumentType || "PASSPORT");
  const [kycProviderReference, setKycProviderReference] = useState(merchant.kycProviderReference || "");
  const [kycMessage, setKycMessage] = useState("");
  const [kycError, setKycError] = useState("");
  const [isSubmittingKyc, setIsSubmittingKyc] = useState(false);
  const [isRefreshingKyc, setIsRefreshingKyc] = useState(false);
  const [tradingAccessMessage, setTradingAccessMessage] = useState("");
  const [tradingAccessError, setTradingAccessError] = useState("");

  async function submitKyc(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setKycMessage("");
    setKycError("");
    setIsSubmittingKyc(true);

    try {
      const response = await fetch("/api/kyc/submissions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token
        },
        body: JSON.stringify({
          applicantName: kycName.trim(),
          documentType: kycDocumentType,
          providerReference: kycProviderReference.trim()
        })
      });
      const payload = await response.json() as ApiMessage;
      if (!response.ok) throw new Error(payload.error || "Could not submit KYC.");
      if (payload.merchant) onMerchantUpdate(payload.merchant);
      setKycMessage(payload.message || "KYC submission received. Your details are awaiting review.");
    } catch (error) {
      setKycError(error instanceof Error ? error.message : "Could not submit KYC.");
    } finally {
      setIsSubmittingKyc(false);
    }
  }

  async function refreshKycStatus() {
    setKycMessage("");
    setKycError("");
    setIsRefreshingKyc(true);

    try {
      const latestMerchant = await getCurrentMerchant(token);
      onMerchantUpdate(latestMerchant);
      if (latestMerchant.kycStatus === "VERIFIED") {
        setKycMessage("Your KYC has been verified. Trading access can now be checked.");
      } else if (latestMerchant.kycStatus === "REJECTED") {
        setKycMessage(latestMerchant.kycRejectionReason
          ? "KYC was not approved: " + latestMerchant.kycRejectionReason
          : "KYC was not approved. Review your details and resubmit if permitted.");
      } else if (latestMerchant.kycStatus === "PENDING") {
        setKycMessage("Your KYC is still under review. Check again later.");
      } else {
        setKycMessage("No KYC submission is currently recorded for this account.");
      }
    } catch (error) {
      setKycError(error instanceof Error ? error.message : "Could not refresh KYC status.");
    } finally {
      setIsRefreshingKyc(false);
    }
  }

  async function checkTradingAccess() {
    setTradingAccessMessage("");
    setTradingAccessError("");

    try {
      const response = await fetch("/api/trading/access", {
        headers: { Authorization: "Bearer " + token }
      });
      const payload = await response.json() as ApiMessage;
      if (!response.ok) throw new Error(payload.error || "Trading access denied.");
      setTradingAccessMessage(payload.message || "Trading access granted.");
    } catch (error) {
      setTradingAccessError(error instanceof Error ? error.message : "Trading access denied.");
    }
  }

  const statusDescription = merchant.kycStatus === "VERIFIED"
    ? "Your KYC status is verified. Check trading authorization with the backend."
    : merchant.kycStatus === "PENDING"
      ? "Your KYC submission is pending review. Trading access stays restricted until verification succeeds."
      : merchant.kycStatus === "REJECTED"
        ? "Your previous submission was not approved. Review the feedback and resubmit if permitted."
        : "Market data is available, but trading access remains restricted until your KYC is verified.";

  return (
    <section className="account-access-panel panel">
      <div className="account-access-main">
        <div className="panel-kicker">ACCOUNT & PERMISSIONS</div>
        <h2>Account security</h2>
        <p className="account-email">{merchant.email} <span className="role-chip">{merchant.role}</span></p>
        <div className="account-status-row">
          <span className={"kyc-status-chip " + (merchant.kycStatus === "VERIFIED" ? "verified" : merchant.kycStatus === "PENDING" ? "pending" : "restricted")}>KYC: {merchant.kycStatus.replaceAll("_", " ")}</span>
          <span className={"kyc-status-chip " + (merchant.accountStatus === "ACTIVE" ? "verified" : "restricted")}>Account: {merchant.accountStatus}</span>
        </div>
        <p className="account-help">{statusDescription}</p>
        {merchant.kycStatus === "REJECTED" && merchant.kycRejectionReason && (
          <p className="form-error" role="status">Review feedback: {merchant.kycRejectionReason}</p>
        )}
        <button
          className="secondary-action"
          type="button"
          onClick={() => { void refreshKycStatus(); }}
          disabled={isRefreshingKyc || isSubmittingKyc}
        >
          {isRefreshingKyc ? "Refreshing status…" : "Refresh KYC status"}
        </button>
        {kycMessage && <p className="form-success" role="status">{kycMessage}</p>}
        {kycError && <p className="form-error" role="alert">{kycError}</p>}
      </div>
      <div className="account-access-actions">
        {merchant.role === "MERCHANT" && merchant.kycStatus !== "VERIFIED" && merchant.kycStatus !== "PENDING" && (
          <form className="kyc-form" onSubmit={submitKyc}>
            <label>Applicant name<input value={kycName} onChange={(event) => setKycName(event.target.value)} required minLength={2} maxLength={120} placeholder="Full legal name" /></label>
            <label>Document type<select value={kycDocumentType} onChange={(event) => setKycDocumentType(event.target.value)}><option value="PASSPORT">Passport</option><option value="NATIONAL_ID">National ID</option><option value="DRIVING_LICENSE">Driving licence</option></select></label>
            <label>Provider reference<input value={kycProviderReference} onChange={(event) => setKycProviderReference(event.target.value)} required minLength={1} maxLength={200} placeholder="Reference from your KYC provider" /></label>
            <button className="primary-action" type="submit" disabled={isSubmittingKyc || isRefreshingKyc}>
              {isSubmittingKyc ? "Submitting…" : merchant.kycStatus === "REJECTED" ? "Resubmit KYC details" : "Submit KYC details"}
            </button>
            <p className="kyc-disclaimer">Demo flow: metadata only. Do not enter document numbers or upload identity documents here.</p>
          </form>
        )}
        {(merchant.kycStatus === "PENDING" || merchant.kycStatus === "VERIFIED" || merchant.kycStatus === "REJECTED") && (
          <div className="trading-access-box">
            <div>
              <strong>{merchant.kycStatus === "PENDING" ? "Verification in progress" : merchant.kycStatus === "VERIFIED" ? "KYC verified" : "Verification needs attention"}</strong>
              <small>{merchant.kycStatus === "PENDING" ? "Your submission is awaiting review. Refresh to see updates." : merchant.kycStatus === "VERIFIED" ? "Your latest status is approved by the backend." : "Check the review feedback before resubmitting."}</small>
            </div>
          </div>
        )}
        <div className="trading-access-box">
          <div><strong>Trading authorization</strong><small>Verified by the API, not by the UI</small></div>
          <button className="secondary-action" onClick={() => { void checkTradingAccess(); }}>Check access</button>
          {tradingAccessMessage && <p className="form-success" role="status">{tradingAccessMessage}</p>}
          {tradingAccessError && <p className="form-error" role="alert">{tradingAccessError}</p>}
        </div>
      </div>
    </section>
  );
}

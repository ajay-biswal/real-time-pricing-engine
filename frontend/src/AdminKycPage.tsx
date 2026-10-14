import { useCallback, useState } from "react";
import { Activity, ArrowLeft, CheckCircle2, Clock3, LockKeyhole, RefreshCw, ShieldCheck, XCircle } from "lucide-react";

type PendingSubmission = {
  id: string;
  email: string;
  kycApplicantName: string | null;
  kycDocumentType: string | null;
  kycProviderReference: string | null;
  kycSubmittedAt: string | null;
};
type PendingResponse = { submissions?: PendingSubmission[]; error?: string; message?: string };

export default function AdminKycPage() {
  const [apiKey, setApiKey] = useState("");
  const [submissions, setSubmissions] = useState<PendingSubmission[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeReview, setActiveReview] = useState<string | null>(null);
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadSubmissions = useCallback(async () => {
    if (!apiKey.trim()) {
      setError("Enter the development admin API key to load pending submissions.");
      return;
    }
    setIsLoading(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/kyc/admin/submissions", { headers: { "x-admin-api-key": apiKey.trim() } });
      const payload = await response.json() as PendingResponse;
      if (!response.ok) throw new Error(payload.error || "Could not load KYC submissions.");
      setSubmissions(payload.submissions ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load KYC submissions.");
    } finally {
      setIsLoading(false);
    }
  }, [apiKey]);

  async function review(submission: PendingSubmission, status: "VERIFIED" | "REJECTED") {
    const rejectionReason = (rejectionReasons[submission.id] ?? "").trim();
    if (status === "REJECTED" && !rejectionReason) {
      setError("Add a rejection reason before rejecting an application.");
      return;
    }
    setActiveReview(submission.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/kyc/admin/merchants/" + encodeURIComponent(submission.id) + "/kyc", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-api-key": apiKey.trim() },
        body: JSON.stringify(status === "REJECTED" ? { status, rejectionReason } : { status }),
      });
      const payload = await response.json() as PendingResponse;
      if (!response.ok) throw new Error(payload.error || "Could not update KYC status.");
      setNotice((status === "VERIFIED" ? "Approved " : "Rejected ") + (submission.kycApplicantName || submission.email) + ".");
      setSubmissions((current) => current.filter((item) => item.id !== submission.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update KYC status.");
    } finally {
      setActiveReview(null);
    }
  }

  return <main className="admin-kyc-screen">
    <header className="admin-kyc-topbar">
      <a className="admin-back-link" href="/" aria-label="Back to dashboard"><ArrowLeft size={16} /> Dashboard</a>
      <div className="admin-brand"><span className="auth-brand-mark"><ShieldCheck size={20} /></span><span><strong>pulse<span>.</span> Admin</strong><small>KYC REVIEW CONSOLE</small></span></div>
      <span className="admin-dev-badge"><LockKeyhole size={12} /> DEVELOPMENT ONLY</span>
    </header>
    <section className="admin-kyc-content">
      <div className="eyebrow"><span className="eyebrow-line" /> COMPLIANCE WORKSPACE</div>
      <div className="admin-kyc-heading">
        <div><h1>KYC review queue<span className="heading-period">.</span></h1><p className="page-subtitle">Review merchant-submitted KYC metadata and record a decision.</p></div>
        <div className="admin-queue-count"><strong>{submissions.length}</strong><span>Pending review</span></div>
      </div>
      <div className="admin-dev-warning"><LockKeyhole size={17} /><p><strong>Development-only admin access</strong><span>This console uses the server-configured ADMIN_API_KEY. The backend disables these review endpoints in production. Never put an admin key in frontend code or ship this key-based flow to production.</span></p></div>
      <form className="admin-key-form" onSubmit={(event) => { event.preventDefault(); void loadSubmissions(); }}>
        <label htmlFor="admin-api-key">Development admin API key</label>
        <div><input id="admin-api-key" type="password" autoComplete="current-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Enter ADMIN_API_KEY from your local .env" required /><button className="primary-action" type="submit" disabled={isLoading || !apiKey.trim()}>{isLoading ? "Loading…" : "Load pending applications"}</button></div>
        <small>Key stays in this page's memory only; it is not saved in local storage.</small>
      </form>
      {notice && <p className="admin-feedback success" role="status">{notice}</p>}
      {error && <p className="admin-feedback error" role="alert">{error}</p>}
      <div className="admin-list-heading"><div><h2>Pending applications</h2><p>Oldest submissions appear first.</p></div><button className="secondary-action" type="button" onClick={() => { void loadSubmissions(); }} disabled={isLoading || !apiKey.trim()}><RefreshCw size={13} /> Refresh queue</button></div>
      {isLoading ? <div className="admin-empty-state"><RefreshCw size={22} /><strong>Loading submissions…</strong></div>
        : submissions.length === 0 ? <div className="admin-empty-state"><CheckCircle2 size={24} /><strong>No pending applications</strong><span>Load the queue to check for new merchant submissions.</span></div>
          : <div className="admin-submission-list">{submissions.map((submission) => <article className="admin-submission-card" key={submission.id}>
            <div className="admin-submission-top"><div className="admin-applicant-avatar">{(submission.kycApplicantName || submission.email).slice(0, 1).toUpperCase()}</div><div className="admin-applicant-details"><h3>{submission.kycApplicantName || "Applicant name not provided"}</h3><p>{submission.email}</p></div><span className="kyc-status-chip pending"><Clock3 size={12} /> PENDING</span></div>
            <div className="admin-submission-meta"><div><span>DOCUMENT TYPE</span><strong>{(submission.kycDocumentType || "Not provided").replaceAll("_", " ")}</strong></div><div><span>PROVIDER REFERENCE</span><strong>{submission.kycProviderReference || "Not provided"}</strong></div><div><span>SUBMITTED</span><strong>{submission.kycSubmittedAt ? new Date(submission.kycSubmittedAt).toLocaleString() : "Unknown"}</strong></div><div><span>MERCHANT ID</span><strong title={submission.id}>{submission.id}</strong></div></div>
            <div className="admin-review-actions"><label>Rejection reason (required to reject)<textarea value={rejectionReasons[submission.id] ?? ""} maxLength={500} onChange={(event) => setRejectionReasons((current) => ({ ...current, [submission.id]: event.target.value }))} placeholder="Explain what the merchant needs to correct…" /></label><div><button className="admin-reject-button" type="button" onClick={() => { void review(submission, "REJECTED"); }} disabled={activeReview !== null}><XCircle size={14} /> {activeReview === submission.id ? "Saving…" : "Reject application"}</button><button className="admin-approve-button" type="button" onClick={() => { void review(submission, "VERIFIED"); }} disabled={activeReview !== null}><CheckCircle2 size={14} /> {activeReview === submission.id ? "Saving…" : "Approve KYC"}</button></div></div>
          </article>)}</div>}
      <p className="admin-kyc-footnote"><Activity size={13} /> This demo reviews metadata only. It does not verify identity documents or connect to a KYC provider.</p>
    </section>
  </main>;
}

import { useState, type FormEvent } from "react";
import { Activity, ArrowRight, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { loginAccount, registerAccount, type LoginResponse } from "./auth";

type Props = { onAuthenticated: (session: LoginResponse) => void };

export default function AuthScreen({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      if (mode === "register") {
        await registerAccount(email, password);
        setMode("login");
        setPassword("");
        setNotice("Account created. Sign in to continue; KYC verification is required before trading access.");
      } else {
        onAuthenticated(await loginAccount(email, password));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authentication failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-screen">
    <div className="auth-glow auth-glow-one" /><div className="auth-glow auth-glow-two" />
    <section className="auth-card">
      <div className="auth-brand"><span className="auth-brand-mark"><Activity size={21} /></span><span><strong>Pulse<span>Markets</span></strong><small>REAL-TIME PRICING ENGINE</small></span></div>
      <div className="auth-eyebrow"><ShieldCheck size={14} /> SECURE MERCHANT WORKSPACE</div>
      <h1>{mode === "login" ? "Welcome back." : "Create your account."}</h1>
      <p className="auth-subtitle">{mode === "login" ? "Sign in to access live market monitoring and your account permissions." : "Create a merchant account to start the verification process."}</p>
      <div className="auth-mode-tabs"><button className={mode === "login" ? "selected" : ""} onClick={() => { setMode("login"); setError(""); setNotice(""); }} type="button">Sign in</button><button className={mode === "register" ? "selected" : ""} onClick={() => { setMode("register"); setError(""); setNotice(""); }} type="button">Create account</button></div>
      <form className="auth-form" onSubmit={submit}>
        <label>Email address<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" /></label>
        <label>Password<span className="password-input"><input type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "register" ? 12 : 1} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "register" ? "At least 12 characters" : "Enter your password"} /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></span></label>
        {notice && <p className="auth-notice" role="status">{notice}</p>}
        {error && <p className="form-error auth-error" role="alert">{error}</p>}
        <button className="auth-submit" disabled={busy} type="submit">{busy ? "Please wait…" : mode === "login" ? "Sign in securely" : "Create merchant account"} {!busy && <ArrowRight size={16} />}</button>
      </form>
      <div className="auth-security-note"><ShieldCheck size={15} /><span><strong>Protected by server-side authorization</strong><small>Passwords are hashed by the API. Access tokens are kept for this browser tab session.</small></span></div>
      <p className="auth-footnote">Market data is informational. Trading access requires an active account and verified KYC.</p>
    </section>
  </main>;
}

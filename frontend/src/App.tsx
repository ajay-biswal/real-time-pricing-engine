import { useEffect, useState } from "react";
import AuthScreen from "./AuthScreen";
import AdminKycPage from "./AdminKycPage";
import { getCurrentMerchant, logoutAccount, type LoginResponse, type Merchant } from "./auth";
import { MarketDashboard } from "./MarketDashboard";

const TOKEN_KEY = "pricing-engine.access-token";

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const isAdminKycPath = window.location.pathname.replace(/\/+$/, "") === "/admin/kyc";

  useEffect(() => {
    let active = true;
    if (isAdminKycPath) {
      setCheckingSession(false);
      return () => { active = false; };
    }
    const savedToken = window.sessionStorage.getItem(TOKEN_KEY);
    if (!savedToken) {
      setCheckingSession(false);
      return () => { active = false; };
    }

    void getCurrentMerchant(savedToken)
      .then((currentMerchant) => {
        if (!active) return;
        setToken(savedToken);
        setMerchant(currentMerchant);
      })
      .catch(() => {
        window.sessionStorage.removeItem(TOKEN_KEY);
        if (active) {
          setToken(null);
          setMerchant(null);
        }
      })
      .finally(() => {
        if (active) setCheckingSession(false);
      });

    return () => { active = false; };
  }, [isAdminKycPath]);

  function handleAuthenticated(session: LoginResponse) {
    window.sessionStorage.setItem(TOKEN_KEY, session.accessToken);
    setToken(session.accessToken);
    setMerchant(session.merchant);
  }

  async function handleLogout() {
    const currentToken = token;
    try {
      if (currentToken) await logoutAccount(currentToken);
    } catch {
      // Clear the local session even if the network is unavailable; the server token expires naturally.
    } finally {
      window.sessionStorage.removeItem(TOKEN_KEY);
      setToken(null);
      setMerchant(null);
    }
  }

  if (isAdminKycPath) return <AdminKycPage />;

  if (checkingSession) {
    return <main className="auth-screen"><div className="auth-loading"><span className="auth-brand-mark"><ShieldCheckIcon /></span><strong>Checking your session…</strong></div></main>;
  }

  if (!token || !merchant) return <AuthScreen onAuthenticated={handleAuthenticated} />;

  return <MarketDashboard
    merchant={merchant}
    token={token}
    onLogout={() => { void handleLogout(); }}
    onMerchantUpdate={setMerchant}
  />;
}

function ShieldCheckIcon() {
  return <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></svg>;
}

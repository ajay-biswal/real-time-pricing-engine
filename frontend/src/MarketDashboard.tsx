import { useMemo, useState } from "react";
import { Activity, ArrowDownRight, ArrowUpRight, WifiOff } from "lucide-react";
import type { Merchant } from "./auth";
import { formatTime, numeric, SYMBOLS, type Category } from "./marketCatalog";
import { useMarketData } from "./useMarketData";
import { AccountAccessPanel } from "./features/account/AccountAccessPanel";
import { MarketDirectory } from "./features/markets/MarketDirectory";
import { MarketChartPanel } from "./features/markets/MarketChartPanel";
import { TopMoversPanel } from "./features/markets/TopMoversPanel";

type DashboardProps = { merchant: Merchant; token: string; onLogout: () => void; onMerchantUpdate: (merchant: Merchant) => void };

export function MarketDashboard({ merchant, token, onLogout, onMerchantUpdate }: DashboardProps) {
  const { connection, snapshots, history, lastMessageAt, socketError } = useMarketData();
  const [selectedSymbol, setSelectedSymbol] = useState("EURUSD");
  const [category, setCategory] = useState<Category>("ALL");
  const [search, setSearch] = useState("");

  const visibleSymbols = useMemo(() => SYMBOLS.filter((item) => {
    const matchesCategory = category === "ALL" || item.category === category;
    const query = search.trim().toLowerCase();
    return matchesCategory && (!query || item.symbol.toLowerCase().includes(query) || item.name.toLowerCase().includes(query));
  }), [category, search]);
  const activeCount = Object.keys(snapshots).length;
  const positiveCount = Object.values(snapshots).filter((item) => (numeric(item.change24h) || 0) > 0).length;
  const negativeCount = Object.values(snapshots).filter((item) => (numeric(item.change24h) || 0) < 0).length;

  const connectionLabel = connection === "connected" ? "Live" : connection === "connecting" ? "Connecting" : connection === "reconnecting" ? "Reconnecting" : "Offline";

  return <div className="app-shell">
    <main className="main-content">
      <header className="topbar">
        <a className="dashboard-brand" href="/" aria-label="Pulse markets home"><span className="dashboard-brand-mark"><Activity size={18} /></span><strong>pulse<span>.</span></strong></a>
        <div className="topbar-actions">
          <div className={"connection-pill " + connection}><span className="connection-dot" />{connectionLabel}</div>
          <button className="profile-row dashboard-profile" onClick={onLogout} title="Sign out"><span className="dashboard-avatar">{merchant.email.slice(0, 1).toUpperCase()}</span><span><strong>{merchant.email}</strong><small>Sign out</small></span></button>
        </div>
      </header>
      <div className="page-container">
        <section className="page-heading">
          <div><h1>Market overview</h1><p className="page-subtitle">Live prices across forex, metals and crypto.</p></div>
          <div className="market-updated">Updated {lastMessageAt ? formatTime(lastMessageAt) : "—"}</div>
        </section>
        {socketError && <div className="inline-alert"><WifiOff size={16} /><span>{socketError}</span></div>}
        <section className="summary-grid" aria-label="Market summary">
          <article className="summary-card"><div className="summary-top"><span>MARKETS REPORTING</span><span className="summary-icon blue"><Activity size={17} /></span></div><div className="summary-value">{activeCount}<span className="summary-total"> / {SYMBOLS.length}</span></div></article>
          <article className="summary-card"><div className="summary-top"><span>MARKETS UP</span><span className="summary-icon blue"><ArrowUpRight size={18} /></span></div><div className="summary-value up-value">{String(positiveCount).padStart(2, "0")}</div><div className="summary-foot">Positive 24h change</div></article>
          <article className="summary-card"><div className="summary-top"><span>MARKETS DOWN</span><span className="summary-icon red"><ArrowDownRight size={18} /></span></div><div className="summary-value down-value">{String(negativeCount).padStart(2, "0")}</div><div className="summary-foot">Negative 24h change</div></article>
        </section>
        <section className="market-layout">
          <MarketChartPanel
            selected={SYMBOLS.find((item) => item.symbol === selectedSymbol) || SYMBOLS[0]!}
            snapshot={snapshots[selectedSymbol]}
            history={history[selectedSymbol] || []}
            connection={connection}
          />
          <TopMoversPanel snapshots={snapshots} activeCount={activeCount} onSelectSymbol={setSelectedSymbol} />
        </section>
        <MarketDirectory
          visibleSymbols={visibleSymbols}
          category={category}
          onCategoryChange={setCategory}
          search={search}
          onSearchChange={setSearch}
          snapshots={snapshots}
          selectedSymbol={selectedSymbol}
          onSelectSymbol={setSelectedSymbol}
        />
        <details className="account-details">
          <summary>Account and verification</summary>
          <AccountAccessPanel merchant={merchant} token={token} onMerchantUpdate={onMerchantUpdate} />
        </details>
      </div>
    </main>
  </div>;
}

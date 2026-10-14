import { useMemo, useState } from "react";
import { Activity, ArrowDownRight, ArrowUpRight, Bell, ChevronDown, CircleHelp, Clock3, Globe2, LayoutDashboard, LineChart, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import type { Merchant } from "./auth";
import { formatChange, formatTime, numeric, SYMBOLS, type Category } from "./marketCatalog";
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

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand-lockup"><div className="brand-mark"><Activity size={19} strokeWidth={2.5} /></div><div><div className="brand-name">pulse<span>.</span></div><div className="brand-caption">MARKET INTELLIGENCE</div></div></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav className="side-nav" aria-label="Main navigation"><button className="nav-item active"><LayoutDashboard size={17} /> Overview <span className="nav-indicator" /></button><button className="nav-item" onClick={() => document.getElementById("markets")?.scrollIntoView({ behavior: "smooth" })}><LineChart size={17} /> Markets</button></nav>
      <div className="sidebar-divider" />
      <div className="workspace-label">YOUR WATCHLIST</div>
      <div className="mini-watchlist">{SYMBOLS.slice(0, 5).map((item) => {
        const snapshot = snapshots[item.symbol]; const change = numeric(snapshot?.change24h) || 0;
        return <button key={item.symbol} className={selectedSymbol === item.symbol ? "mini-market selected" : "mini-market"} onClick={() => setSelectedSymbol(item.symbol)}><span className="mini-symbol-icon">{item.flag}</span><span className="mini-market-label"><strong>{item.symbol}</strong><small>{item.name.split(" / ")[0]}</small></span><span className={"mini-change " + (change > 0 ? "positive" : change < 0 ? "negative" : "")}>{snapshot ? formatChange(snapshot.change24h) : "—"}</span></button>;
      })}</div>
      <div className="sidebar-bottom"><div className="secure-note"><ShieldCheck size={16} /><span><strong>Authenticated session</strong><small>API access is checked by the backend</small></span></div><button className="profile-row" onClick={onLogout} title="Sign out"><div className="avatar">{merchant.email.slice(0, 1).toUpperCase()}</div><span><strong>{merchant.email}</strong><small>{merchant.role} · Sign out</small></span><ChevronDown size={15} /></button></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>Overview</strong></div><div className="topbar-actions"><div className={"connection-pill " + connection}><span className="connection-dot" />{connection === "connected" ? "Live connection" : connection === "connecting" ? "Connecting" : connection === "reconnecting" ? "Reconnecting" : "Disconnected"}</div><button className="icon-button" aria-label="Notifications"><Bell size={17} /></button><div className="topbar-avatar" title={merchant.email}>{merchant.email.slice(0, 1).toUpperCase()}</div></div></header>
      <div className="page-container">
        <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> MARKET OVERVIEW <span className="eyebrow-date">{new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span></div><h1>Good morning<span className="heading-period">.</span></h1><p className="page-subtitle">Your markets, moving in real time. Here's what's happening today.</p></div><div className="heading-right"><div className="market-open-icon"><Globe2 size={17} /></div><div><strong>Global markets</strong><span>Multi-asset coverage</span></div><span title="Values are supplied by your live pricing engine"><CircleHelp size={17} /></span></div></section>
        {socketError && <div className="inline-alert"><WifiOff size={16} /><span>{socketError}</span></div>}

        <AccountAccessPanel merchant={merchant} token={token} onMerchantUpdate={onMerchantUpdate} />
        <section className="summary-grid" aria-label="Market summary">
          <article className="summary-card"><div className="summary-top"><span>TRACKED MARKETS</span><span className="summary-icon violet"><Globe2 size={17} /></span></div><div className="summary-value">{activeCount}<span className="summary-total"> / {SYMBOLS.length}</span></div><div className="summary-foot"><Activity size={13} />{activeCount ? "Markets reporting data" : "Waiting for first prices"}</div></article>
          <article className="summary-card"><div className="summary-top"><span>MARKETS UP</span><span className="summary-icon green"><ArrowUpRight size={18} /></span></div><div className="summary-value">{String(positiveCount).padStart(2, "0")}</div><div className="summary-foot"><span className="status-bullet green-bullet" />Positive 24h change</div></article>
          <article className="summary-card"><div className="summary-top"><span>MARKETS DOWN</span><span className="summary-icon red"><ArrowDownRight size={18} /></span></div><div className="summary-value">{String(negativeCount).padStart(2, "0")}</div><div className="summary-foot"><span className="status-bullet red-bullet" />Negative 24h change</div></article>
          <article className="summary-card connection-summary"><div className="summary-top"><span>ENGINE STATUS</span><span className="summary-icon blue"><Wifi size={17} /></span></div><div className="engine-status"><span className={"engine-pulse " + (connection === "connected" ? "is-live" : "")} />{connection === "connected" ? "Connected" : connection === "connecting" ? "Connecting" : connection === "reconnecting" ? "Reconnecting" : "Offline"}</div><div className="summary-foot"><Clock3 size={13} />{lastMessageAt ? "Last tick " + formatTime(lastMessageAt) : "Awaiting provider data"}</div></article>
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
          connection={connection}
        />
        <footer className="page-footer"><span>© {new Date().getFullYear()} Pulse Market Monitor</span><span><ShieldCheck size={13} /> Built on your Real-Time Pricing Engine</span><span>Last message: {formatTime(lastMessageAt || undefined)}</span></footer>
      </div>
    </main>
  </div>;
}

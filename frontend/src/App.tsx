import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowDownRight, ArrowUpRight, Bell, ChevronDown, CircleHelp, Clock3, Globe2, LayoutDashboard, LineChart, Search, ShieldCheck, Star, Wifi, WifiOff } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ConnectionState, MarketSnapshot, ServerMessage } from "./types";

const SYMBOLS = [
  { symbol: "EURUSD", name: "Euro / US Dollar", category: "FX", flag: "🇪🇺" },
  { symbol: "GBPUSD", name: "British Pound / US Dollar", category: "FX", flag: "🇬🇧" },
  { symbol: "USDJPY", name: "US Dollar / Japanese Yen", category: "FX", flag: "🇯🇵" },
  { symbol: "AUDUSD", name: "Australian Dollar / US Dollar", category: "FX", flag: "🇦🇺" },
  { symbol: "USDCAD", name: "US Dollar / Canadian Dollar", category: "FX", flag: "🇨🇦" },
  { symbol: "USDCHF", name: "US Dollar / Swiss Franc", category: "FX", flag: "🇨🇭" },
  { symbol: "XAUUSD", name: "Gold / US Dollar", category: "METALS", flag: "◈" },
  { symbol: "XAGUSD", name: "Silver / US Dollar", category: "METALS", flag: "◇" },
  { symbol: "BTCUSD", name: "Bitcoin / US Dollar", category: "CRYPTO", flag: "₿" },
  { symbol: "ETHUSD", name: "Ethereum / US Dollar", category: "CRYPTO", flag: "Ξ" },
  { symbol: "BNBUSD", name: "BNB / US Dollar", category: "CRYPTO", flag: "◆" },
  { symbol: "SOLUSD", name: "Solana / US Dollar", category: "CRYPTO", flag: "◎" }
] as const;

type Category = "ALL" | "FX" | "METALS" | "CRYPTO";
type ChartPoint = { time: number; price: number };
function numeric(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
function formatPrice(value: string | number | undefined, symbol = ""): string {
  const parsed = typeof value === "number" ? value : numeric(value);
  if (parsed === null) return "—";
  const digits = symbol.endsWith("JPY") ? 3 : parsed >= 1000 ? 2 : parsed >= 10 ? 4 : 5;
  return parsed.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function formatChange(value: string | undefined): string {
  const parsed = numeric(value);
  return parsed === null ? "—" : (parsed > 0 ? "+" : "") + parsed.toFixed(2) + "%";
}
function formatTime(value: string | undefined): string {
  if (!value) return "Waiting for first update";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Timestamp unavailable" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function App() {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [snapshots, setSnapshots] = useState<Record<string, MarketSnapshot>>({});
  const [history, setHistory] = useState<Record<string, ChartPoint[]>>({});
  const [selectedSymbol, setSelectedSymbol] = useState("EURUSD");
  const [category, setCategory] = useState<Category>("ALL");
  const [search, setSearch] = useState("");
  const [lastMessageAt, setLastMessageAt] = useState<string | null>(null);
  const [socketError, setSocketError] = useState<string | null>(null);

  useEffect(() => {
    let socket: WebSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let disposed = false;
    const scheduleReconnect = () => {
      if (disposed || reconnectTimer) return;
      attempts += 1;
      const delay = Math.min(1000 * 2 ** Math.min(attempts - 1, 5), 15000);
      reconnectTimer = setTimeout(() => { reconnectTimer = undefined; connect(); }, delay);
    };
    const connect = () => {
      if (disposed) return;
      setConnection(attempts === 0 ? "connecting" : "reconnecting");
      const url = import.meta.env.VITE_WS_URL || ((window.location.protocol === "https:" ? "wss:" : "ws:") + "//" + window.location.host + "/ws");
      try { socket = new WebSocket(url); }
      catch { setConnection("disconnected"); setSocketError("Could not create a WebSocket connection."); scheduleReconnect(); return; }
      socket.addEventListener("open", () => {
        attempts = 0;
        setConnection("connected");
        setSocketError(null);
        socket?.send(JSON.stringify({ action: "subscribe", symbols: SYMBOLS.map((item) => item.symbol) }));
      });
      socket.addEventListener("message", (event) => {
        let message: ServerMessage;
        try { message = JSON.parse(String(event.data)) as ServerMessage; }
        catch { setSocketError("Received an unreadable message from the server."); return; }
        if (message.event === "error") { setSocketError(message.message || "The server rejected a request."); return; }
        if ((message.event === "marketPriceSnapshot" || message.event === "marketPriceUpdate") && message.data && typeof message.data.symbol === "string") {
          const snapshot = message.data;
          setSnapshots((current) => ({ ...current, [snapshot.symbol]: snapshot }));
          const price = numeric(snapshot.buy);
          const timestamp = new Date(snapshot.updatedAt).getTime();
          if (price !== null) {
            setHistory((current) => {
              const previous = current[snapshot.symbol] || [];
              return { ...current, [snapshot.symbol]: [...previous, { time: Number.isFinite(timestamp) ? timestamp : Date.now(), price }].slice(-90) };
            });
          }
          setLastMessageAt(new Date().toISOString());
        }
      });
      socket.addEventListener("error", () => setSocketError("Connection issue. Retrying automatically."));
      socket.addEventListener("close", () => {
        if (!disposed) { setConnection("reconnecting"); scheduleReconnect(); }
      });
    };
    connect();
    return () => { disposed = true; if (reconnectTimer) clearTimeout(reconnectTimer); socket?.close(); };
  }, []);

  const visibleSymbols = useMemo(() => SYMBOLS.filter((item) => {
    const matchesCategory = category === "ALL" || item.category === category;
    const query = search.trim().toLowerCase();
    return matchesCategory && (!query || item.symbol.toLowerCase().includes(query) || item.name.toLowerCase().includes(query));
  }), [category, search]);
  const selected = SYMBOLS.find((item) => item.symbol === selectedSymbol) || SYMBOLS[0]!;
  const selectedSnapshot = snapshots[selectedSymbol];
  const selectedHistory = history[selectedSymbol] || [];
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
      <div className="sidebar-bottom"><div className="secure-note"><ShieldCheck size={16} /><span><strong>Secure data pipeline</strong><small>Powered by your pricing engine</small></span></div><div className="profile-row"><div className="avatar">PM</div><span><strong>Personal workspace</strong><small>Market analyst</small></span><ChevronDown size={15} /></div></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>Overview</strong></div><div className="topbar-actions"><div className={"connection-pill " + connection}><span className="connection-dot" />{connection === "connected" ? "Live connection" : connection === "connecting" ? "Connecting" : connection === "reconnecting" ? "Reconnecting" : "Disconnected"}</div><button className="icon-button" aria-label="Notifications"><Bell size={17} /></button><div className="topbar-avatar">A</div></div></header>
      <div className="page-container">
        <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> MARKET OVERVIEW <span className="eyebrow-date">{new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span></div><h1>Good morning<span className="heading-period">.</span></h1><p className="page-subtitle">Your markets, moving in real time. Here's what's happening today.</p></div><div className="heading-right"><div className="market-open-icon"><Globe2 size={17} /></div><div><strong>Global markets</strong><span>Multi-asset coverage</span></div><span title="Values are supplied by your live pricing engine"><CircleHelp size={17} /></span></div></section>
        {socketError && <div className="inline-alert"><WifiOff size={16} /><span>{socketError}</span></div>}
        <section className="summary-grid" aria-label="Market summary">
          <article className="summary-card"><div className="summary-top"><span>TRACKED MARKETS</span><span className="summary-icon violet"><Globe2 size={17} /></span></div><div className="summary-value">{activeCount}<span className="summary-total"> / {SYMBOLS.length}</span></div><div className="summary-foot"><Activity size={13} />{activeCount ? "Markets reporting data" : "Waiting for first prices"}</div></article>
          <article className="summary-card"><div className="summary-top"><span>MARKETS UP</span><span className="summary-icon green"><ArrowUpRight size={18} /></span></div><div className="summary-value">{String(positiveCount).padStart(2, "0")}</div><div className="summary-foot"><span className="status-bullet green-bullet" />Positive 24h change</div></article>
          <article className="summary-card"><div className="summary-top"><span>MARKETS DOWN</span><span className="summary-icon red"><ArrowDownRight size={18} /></span></div><div className="summary-value">{String(negativeCount).padStart(2, "0")}</div><div className="summary-foot"><span className="status-bullet red-bullet" />Negative 24h change</div></article>
          <article className="summary-card connection-summary"><div className="summary-top"><span>ENGINE STATUS</span><span className="summary-icon blue"><Wifi size={17} /></span></div><div className="engine-status"><span className={"engine-pulse " + (connection === "connected" ? "is-live" : "")} />{connection === "connected" ? "Connected" : connection === "connecting" ? "Connecting" : connection === "reconnecting" ? "Reconnecting" : "Offline"}</div><div className="summary-foot"><Clock3 size={13} />{lastMessageAt ? "Last tick " + formatTime(lastMessageAt) : "Awaiting provider data"}</div></article>
        </section>
        <section className="market-layout">
          <article className="panel chart-panel">
            <div className="panel-heading chart-heading"><div><div className="panel-kicker">MARKET DETAIL</div><div className="selected-market-title"><span className="selected-symbol-icon">{selected.flag}</span><div><h2>{selected.symbol}</h2><p>{selected.name}</p></div><span className="instrument-badge">{selected.category}</span></div></div><div className="timeframe-select">Live session <ChevronDown size={14} /></div></div>
            <div className="chart-price-row"><div className="big-price">{selectedSnapshot ? formatPrice(selectedSnapshot.buy, selectedSymbol) : "—"}<span className="price-currency">{selectedSymbol.endsWith("USD") ? "USD" : selectedSymbol.slice(-3)}</span></div><div className={"price-change " + ((numeric(selectedSnapshot?.change24h) || 0) >= 0 ? "positive" : "negative")}>{(numeric(selectedSnapshot?.change24h) || 0) >= 0 ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}{formatChange(selectedSnapshot?.change24h)} <span>24h</span></div></div>
            <div className="chart-wrap">{selectedHistory.length > 1 ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={selectedHistory} margin={{ top: 14, right: 8, left: 0, bottom: 0 }}><defs><linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b7cff" stopOpacity={0.24} /><stop offset="95%" stopColor="#8b7cff" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="#242a3c" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="time" tickFormatter={(value: number) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} tick={{ fill: "#737c95", fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={42} /><YAxis domain={["auto", "auto"]} orientation="right" tickFormatter={(value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 5 })} tick={{ fill: "#737c95", fontSize: 10 }} axisLine={false} tickLine={false} width={72} /><Tooltip contentStyle={{ background: "#151a2b", border: "1px solid #30364b", borderRadius: 10, color: "#f4f5fb", fontSize: 12 }} labelFormatter={(value) => new Date(Number(value)).toLocaleTimeString()} formatter={(value) => [formatPrice(Number(value), selectedSymbol), "Buy price"]} /><Area type="monotone" dataKey="price" stroke="#9b8cff" strokeWidth={2} fill="url(#priceGradient)" activeDot={{ r: 4, fill: "#b7adff", stroke: "#171b2d", strokeWidth: 2 }} isAnimationActive={false} /></AreaChart></ResponsiveContainer> : <div className="chart-empty"><div className="chart-empty-icon"><LineChart size={22} /></div><strong>{selectedHistory.length === 1 ? "Collecting price history" : "Waiting for live prices"}</strong><span>{selectedHistory.length === 1 ? "The chart will appear after another update arrives." : "Historical points will appear here as updates arrive from the backend."}</span><div className="chart-empty-line" /></div>}</div>
            <div className="chart-footer"><span><i className="legend-dot" />Buy price</span><span className="chart-source"><span className={"source-dot " + (connection === "connected" ? "live" : "")} />{connection === "connected" ? "Streaming from pricing engine" : "Stream not connected"}</span></div>
            <div className="detail-stats"><div className="detail-stat"><span>SELL PRICE</span><strong>{selectedSnapshot ? formatPrice(selectedSnapshot.sell, selectedSymbol) : "—"}</strong><small>Latest sell quote</small></div><div className="detail-stat"><span>24H HIGH</span><strong>{selectedSnapshot ? formatPrice(selectedSnapshot.high24h, selectedSymbol) : "—"}</strong><small>Rolling 24-hour high</small></div><div className="detail-stat"><span>24H LOW</span><strong>{selectedSnapshot ? formatPrice(selectedSnapshot.low24h, selectedSymbol) : "—"}</strong><small>Rolling 24-hour low</small></div><div className="detail-stat"><span>LAST UPDATED</span><strong className="updated-value">{selectedSnapshot ? formatTime(selectedSnapshot.updatedAt) : "—"}</strong><small>Provider event timestamp</small></div></div>
          </article>
          <article className="panel movers-panel"><div className="panel-heading"><div><div className="panel-kicker">MARKET PULSE</div><h2>Top movers</h2></div><span className="live-mini"><span className="source-dot live" />LIVE</span></div><p className="panel-description">Biggest 24-hour moves among markets with data.</p><div className="movers-list">{SYMBOLS.filter((item) => snapshots[item.symbol]).sort((a, b) => Math.abs(numeric(snapshots[b.symbol]?.change24h) || 0) - Math.abs(numeric(snapshots[a.symbol]?.change24h) || 0)).slice(0, 5).map((item) => { const snapshot = snapshots[item.symbol]!; const change = numeric(snapshot.change24h) || 0; return <button key={item.symbol} className="mover-row" onClick={() => setSelectedSymbol(item.symbol)}><span className="mover-icon">{item.flag}</span><span className="mover-name"><strong>{item.symbol}</strong><small>{item.name}</small></span><span className="mover-values"><strong className={change >= 0 ? "positive" : "negative"}>{formatChange(snapshot.change24h)}</strong><small>{formatPrice(snapshot.buy, item.symbol)}</small></span></button>; })}{activeCount === 0 && <div className="movers-empty"><Activity size={18} /><span>Movers will appear when the first market snapshots arrive.</span></div>}</div><div className="movers-note"><ShieldCheck size={14} />Based on engine-calculated rolling 24h change</div></article>
        </section>
        <section className="panel markets-panel" id="markets">
          <div className="panel-heading markets-heading"><div><div className="panel-kicker">MARKET DIRECTORY</div><h2>All markets <span className="count-chip">{SYMBOLS.length}</span></h2></div><label className="search-box"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search markets..." aria-label="Search markets" /><kbd>/</kbd></label></div>
          <div className="filter-tabs" role="tablist" aria-label="Market category">{(["ALL", "FX", "METALS", "CRYPTO"] as Category[]).map((item) => <button key={item} role="tab" aria-selected={category === item} className={category === item ? "filter-tab active" : "filter-tab"} onClick={() => setCategory(item)}>{item === "ALL" ? "All markets" : item === "FX" ? "Forex" : item === "METALS" ? "Metals" : "Crypto"}<span>{item === "ALL" ? SYMBOLS.length : SYMBOLS.filter((symbol) => symbol.category === item).length}</span></button>)}</div>
          <div className="table-scroll"><table className="market-table"><thead><tr><th>INSTRUMENT</th><th>BUY PRICE</th><th>SELL PRICE</th><th>24H CHANGE</th><th>24H HIGH</th><th>24H LOW</th><th>UPDATED</th><th /></tr></thead><tbody>{visibleSymbols.map((item) => { const snapshot = snapshots[item.symbol]; const change = numeric(snapshot?.change24h); return <tr key={item.symbol} className={selectedSymbol === item.symbol ? "selected-row" : ""} onClick={() => setSelectedSymbol(item.symbol)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") setSelectedSymbol(item.symbol); }}><td><div className="instrument-cell"><span className="instrument-icon">{item.flag}</span><span><strong>{item.symbol}</strong><small>{item.name}</small></span></div></td><td className="number-cell">{snapshot ? formatPrice(snapshot.buy, item.symbol) : <span className="waiting-value">Waiting…</span>}</td><td className="number-cell">{snapshot ? formatPrice(snapshot.sell, item.symbol) : "—"}</td><td>{snapshot ? <span className={"change-chip " + ((change || 0) >= 0 ? "up" : "down")}>{(change || 0) >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{formatChange(snapshot.change24h)}</span> : <span className="muted-dash">—</span>}</td><td className="number-cell">{snapshot ? formatPrice(snapshot.high24h, item.symbol) : "—"}</td><td className="number-cell">{snapshot ? formatPrice(snapshot.low24h, item.symbol) : "—"}</td><td className="updated-cell">{snapshot ? formatTime(snapshot.updatedAt) : "—"}</td><td><button className={selectedSymbol === item.symbol ? "star-button starred" : "star-button"} aria-label={"Select " + item.symbol} onClick={(event) => { event.stopPropagation(); setSelectedSymbol(item.symbol); }}><Star size={14} fill={selectedSymbol === item.symbol ? "currentColor" : "none"} /></button></td></tr>; })}{visibleSymbols.length === 0 && <tr><td colSpan={8} className="no-results">No markets match your search.</td></tr>}</tbody></table></div>
          <div className="table-footer"><span>Showing <strong>{visibleSymbols.length}</strong> of <strong>{SYMBOLS.length}</strong> configured markets</span><span><span className={"source-dot " + (connection === "connected" ? "live" : "")} /> Values supplied by backend · No simulated prices</span></div>
        </section>
        <footer className="page-footer"><span>© {new Date().getFullYear()} Pulse Market Monitor</span><span><ShieldCheck size={13} /> Built on your Real-Time Pricing Engine</span><span>Last message: {formatTime(lastMessageAt || undefined)}</span></footer>
      </div>
    </main>
  </div>;
}

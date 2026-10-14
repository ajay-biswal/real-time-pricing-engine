import { ArrowDownRight, ArrowUpRight, Search, Star } from "lucide-react";
import { formatChange, formatPrice, formatTime, numeric, SYMBOLS, type Category, type MarketInstrument } from "../../marketCatalog";
import type { ConnectionState, MarketSnapshot } from "../../types";

type Props = {
  visibleSymbols: MarketInstrument[];
  category: Category;
  onCategoryChange: (category: Category) => void;
  search: string;
  onSearchChange: (value: string) => void;
  snapshots: Record<string, MarketSnapshot>;
  selectedSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  connection: ConnectionState;
};

const CATEGORIES: Category[] = ["ALL", "FX", "METALS", "CRYPTO"];

export function MarketDirectory({
  visibleSymbols,
  category,
  onCategoryChange,
  search,
  onSearchChange,
  snapshots,
  selectedSymbol,
  onSelectSymbol,
  connection
}: Props) {
  return (
    <section className="panel markets-panel" id="markets">
      <div className="panel-heading markets-heading">
        <div>
          <div className="panel-kicker">MARKET DIRECTORY</div>
          <h2>All markets <span className="count-chip">{SYMBOLS.length}</span></h2>
        </div>
        <label className="search-box">
          <Search size={15} />
          <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search markets..." aria-label="Search markets" />
          <kbd>/</kbd>
        </label>
      </div>
      <div className="filter-tabs" role="tablist" aria-label="Market category">
        {CATEGORIES.map((item) => (
          <button
            key={item}
            role="tab"
            aria-selected={category === item}
            className={category === item ? "filter-tab active" : "filter-tab"}
            onClick={() => onCategoryChange(item)}
          >
            {item === "ALL" ? "All markets" : item === "FX" ? "Forex" : item === "METALS" ? "Metals" : "Crypto"}
            <span>{item === "ALL" ? SYMBOLS.length : SYMBOLS.filter((symbol) => symbol.category === item).length}</span>
          </button>
        ))}
      </div>
      <div className="table-scroll">
        <table className="market-table">
          <thead>
            <tr><th>INSTRUMENT</th><th>BUY PRICE</th><th>SELL PRICE</th><th>24H CHANGE</th><th>24H HIGH</th><th>24H LOW</th><th>UPDATED</th><th /></tr>
          </thead>
          <tbody>
            {visibleSymbols.map((item) => {
              const snapshot = snapshots[item.symbol];
              const change = numeric(snapshot?.change24h);
              return (
                <tr
                  key={item.symbol}
                  className={selectedSymbol === item.symbol ? "selected-row" : ""}
                  onClick={() => onSelectSymbol(item.symbol)}
                  tabIndex={0}
                  onKeyDown={(event) => { if (event.key === "Enter") onSelectSymbol(item.symbol); }}
                >
                  <td><div className="instrument-cell"><span className="instrument-icon">{item.flag}</span><span><strong>{item.symbol}</strong><small>{item.name}</small></span></div></td>
                  <td className="number-cell">{snapshot ? formatPrice(snapshot.buy, item.symbol) : <span className="waiting-value">Waiting…</span>}</td>
                  <td className="number-cell">{snapshot ? formatPrice(snapshot.sell, item.symbol) : "—"}</td>
                  <td>{snapshot ? <span className={"change-chip " + ((change || 0) >= 0 ? "up" : "down")}>{(change || 0) >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{formatChange(snapshot.change24h)}</span> : <span className="muted-dash">—</span>}</td>
                  <td className="number-cell">{snapshot ? formatPrice(snapshot.high24h, item.symbol) : "—"}</td>
                  <td className="number-cell">{snapshot ? formatPrice(snapshot.low24h, item.symbol) : "—"}</td>
                  <td className="updated-cell">{snapshot ? formatTime(snapshot.updatedAt) : "—"}</td>
                  <td><button className={selectedSymbol === item.symbol ? "star-button starred" : "star-button"} aria-label={"Select " + item.symbol} onClick={(event) => { event.stopPropagation(); onSelectSymbol(item.symbol); }}><Star size={14} fill={selectedSymbol === item.symbol ? "currentColor" : "none"} /></button></td>
                </tr>
              );
            })}
            {visibleSymbols.length === 0 && <tr><td colSpan={8} className="no-results">No markets match your search.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <span>Showing <strong>{visibleSymbols.length}</strong> of <strong>{SYMBOLS.length}</strong> configured markets</span>
        <span><span className={"source-dot " + (connection === "connected" ? "live" : "")} /> Values supplied by backend · No simulated prices</span>
      </div>
    </section>
  );
}

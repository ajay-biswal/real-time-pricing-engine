import { Activity, ShieldCheck } from "lucide-react";
import { formatChange, formatPrice, numeric, SYMBOLS } from "../../marketCatalog";
import type { MarketSnapshot } from "../../types";

type Props = {
  snapshots: Record<string, MarketSnapshot>;
  activeCount: number;
  onSelectSymbol: (symbol: string) => void;
};

export function TopMoversPanel({ snapshots, activeCount, onSelectSymbol }: Props) {
  const movers = SYMBOLS
    .filter((item) => snapshots[item.symbol])
    .sort((a, b) =>
      Math.abs(numeric(snapshots[b.symbol]?.change24h) || 0) -
      Math.abs(numeric(snapshots[a.symbol]?.change24h) || 0)
    )
    .slice(0, 5);

  return (
    <article className="panel movers-panel">
      <div className="panel-heading">
        <div><div className="panel-kicker">MARKET PULSE</div><h2>Top movers</h2></div>
        <span className="live-mini"><span className="source-dot live" />LIVE</span>
      </div>
      <p className="panel-description">Biggest 24-hour moves among markets with data.</p>
      <div className="movers-list">
        {movers.map((item) => {
          const snapshot = snapshots[item.symbol]!;
          const change = numeric(snapshot.change24h) || 0;
          return (
            <button key={item.symbol} className="mover-row" onClick={() => onSelectSymbol(item.symbol)}>
              <span className="mover-icon">{item.flag}</span>
              <span className="mover-name"><strong>{item.symbol}</strong><small>{item.name}</small></span>
              <span className="mover-values">
                <strong className={change >= 0 ? "positive" : "negative"}>{formatChange(snapshot.change24h)}</strong>
                <small>{formatPrice(snapshot.buy, item.symbol)}</small>
              </span>
            </button>
          );
        })}
        {activeCount === 0 && <div className="movers-empty"><Activity size={18} /><span>Movers will appear when the first market snapshots arrive.</span></div>}
      </div>
      <div className="movers-note"><ShieldCheck size={14} />Based on engine-calculated rolling 24h change</div>
    </article>
  );
}

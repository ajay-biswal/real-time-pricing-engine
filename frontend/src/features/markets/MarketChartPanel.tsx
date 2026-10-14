import { ArrowDownRight, ArrowUpRight, ChevronDown, LineChart } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatChange, formatPrice, formatTime, numeric, type ChartPoint, type MarketInstrument } from "../../marketCatalog";
import type { ConnectionState, MarketSnapshot } from "../../types";

type Props = {
  selected: MarketInstrument;
  snapshot?: MarketSnapshot;
  history: ChartPoint[];
  connection: ConnectionState;
};

export function MarketChartPanel({ selected, snapshot, history, connection }: Props) {
  const { symbol, category } = selected;
  const change = numeric(snapshot?.change24h) || 0;

  return (
    <article className="panel chart-panel">
      <div className="panel-heading chart-heading">
        <div>
          <div className="panel-kicker">MARKET DETAIL</div>
          <div className="selected-market-title">
            <span className="selected-symbol-icon">{selected.flag}</span>
            <div><h2>{symbol}</h2><p>{selected.name}</p></div>
            <span className="instrument-badge">{category}</span>
          </div>
        </div>
        <div className="timeframe-select">Live session <ChevronDown size={14} /></div>
      </div>
      <div className="chart-price-row">
        <div className="big-price">{snapshot ? formatPrice(snapshot.buy, symbol) : "—"}<span className="price-currency">{symbol.endsWith("USD") ? "USD" : symbol.slice(-3)}</span></div>
        <div className={"price-change " + (change >= 0 ? "positive" : "negative")}>
          {change >= 0 ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
          {formatChange(snapshot?.change24h)} <span>24h</span>
        </div>
      </div>
      <div className="chart-wrap">
        {history.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history} margin={{ top: 14, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b7cff" stopOpacity={0.24} />
                  <stop offset="95%" stopColor="#8b7cff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#242a3c" strokeDasharray="3 5" vertical={false} />
              <XAxis dataKey="time" tickFormatter={(value: number) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} tick={{ fill: "#737c95", fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={42} />
              <YAxis domain={["auto", "auto"]} orientation="right" tickFormatter={(value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 5 })} tick={{ fill: "#737c95", fontSize: 10 }} axisLine={false} tickLine={false} width={72} />
              <Tooltip
                contentStyle={{ background: "#151a2b", border: "1px solid #30364b", borderRadius: 10, color: "#f4f5fb", fontSize: 12 }}
                labelFormatter={(value) => new Date(Number(value)).toLocaleTimeString()}
                formatter={(value) => [formatPrice(Number(value), symbol), "Buy price"]}
              />
              <Area type="monotone" dataKey="price" stroke="#9b8cff" strokeWidth={2} fill="url(#priceGradient)" activeDot={{ r: 4, fill: "#b7adff", stroke: "#171b2d", strokeWidth: 2 }} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="chart-empty">
            <div className="chart-empty-icon"><LineChart size={22} /></div>
            <strong>{history.length === 1 ? "Collecting price history" : "Waiting for live prices"}</strong>
            <span>{history.length === 1 ? "The chart will appear after another update arrives." : "Historical points will appear here as updates arrive from the backend."}</span>
            <div className="chart-empty-line" />
          </div>
        )}
      </div>
      <div className="chart-footer">
        <span><i className="legend-dot" />Buy price</span>
        <span className="chart-source"><span className={"source-dot " + (connection === "connected" ? "live" : "")} />{connection === "connected" ? "Streaming from pricing engine" : "Stream not connected"}</span>
      </div>
      <div className="detail-stats">
        <div className="detail-stat"><span>SELL PRICE</span><strong>{snapshot ? formatPrice(snapshot.sell, symbol) : "—"}</strong><small>Latest sell quote</small></div>
        <div className="detail-stat"><span>24H HIGH</span><strong>{snapshot ? formatPrice(snapshot.high24h, symbol) : "—"}</strong><small>Rolling 24-hour high</small></div>
        <div className="detail-stat"><span>24H LOW</span><strong>{snapshot ? formatPrice(snapshot.low24h, symbol) : "—"}</strong><small>Rolling 24-hour low</small></div>
        <div className="detail-stat"><span>LAST UPDATED</span><strong className="updated-value">{snapshot ? formatTime(snapshot.updatedAt) : "—"}</strong><small>Provider event timestamp</small></div>
      </div>
    </article>
  );
}

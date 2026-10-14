import type { MarketSnapshot } from "./types";

export const SYMBOL_CODES = [
  "AUDUSD", "AUDCAD", "AUDCHF", "AUDJPY", "AUDNZD", "AUDSGD",
  "CADCHF", "CADJPY", "CHFJPY", "CHFSGD", "EURAUD", "EURCAD",
  "EURCHF", "EURGBP", "EURJPY", "EURNZD", "EURUSD", "GBPAUD",
  "GBPCAD", "GBPCHF", "GBPJPY", "GBPNZD", "GBPUSD", "NZDCAD",
  "NZDCHF", "NZDJPY", "NZDUSD", "USDCAD", "USDCHF", "USDCNH",
  "USDJPY", "USDMXN", "USDNOK", "USDPLN", "USDSEK", "USDSGD",
  "USDTRY", "USDZAR", "EURTRY", "GBPTRY", "NOKJPY", "SEKJPY",
  "SGDJPY", "ZARJPY", "XAUUSD", "XAGUSD", "BTCUSD", "ETHUSD",
  "BNBUSD", "SOLUSD", "XRPUSD", "ADAUSD", "DOGUSD", "DOTUSD",
  "LTCUSD", "BCHUSD", "XLMUSD", "TRXUSD", "UNIUSD", "FILUSD",
  "AVXUSD"
] as const;

export type Category = "ALL" | "FX" | "METALS" | "CRYPTO";
export type MarketCategory = Exclude<Category, "ALL">;
export type MarketInstrument = { symbol: string; name: string; category: MarketCategory; flag: string };
export type ChartPoint = { time: number; price: number };

const CURRENCY_NAMES: Record<string, string> = {
  AUD: "Australian Dollar", CAD: "Canadian Dollar", CHF: "Swiss Franc",
  CNH: "Chinese Yuan", EUR: "Euro", GBP: "British Pound", JPY: "Japanese Yen",
  MXN: "Mexican Peso", NOK: "Norwegian Krone", NZD: "New Zealand Dollar",
  PLN: "Polish Zloty", SEK: "Swedish Krona", SGD: "Singapore Dollar",
  TRY: "Turkish Lira", USD: "US Dollar", ZAR: "South African Rand",
  XAU: "Gold", XAG: "Silver", BTC: "Bitcoin", ETH: "Ethereum", BNB: "BNB",
  SOL: "Solana", XRP: "XRP", ADA: "Cardano", DOG: "Dogecoin", DOT: "Polkadot",
  LTC: "Litecoin", BCH: "Bitcoin Cash", XLM: "Stellar", TRX: "TRON",
  UNI: "Uniswap", FIL: "Filecoin", AVX: "AVX"
};

const CRYPTO_SYMBOLS = new Set([
  "BTCUSD", "ETHUSD", "BNBUSD", "SOLUSD", "XRPUSD", "ADAUSD", "DOGUSD",
  "DOTUSD", "LTCUSD", "BCHUSD", "XLMUSD", "TRXUSD", "UNIUSD", "FILUSD", "AVXUSD"
]);

export const SYMBOLS: MarketInstrument[] = SYMBOL_CODES.map((symbol) => {
  const base = symbol.slice(0, 3);
  const quote = symbol.slice(3);
  const category: MarketCategory =
    symbol === "XAUUSD" || symbol === "XAGUSD"
      ? "METALS"
      : CRYPTO_SYMBOLS.has(symbol)
        ? "CRYPTO"
        : "FX";
  const flag =
    base === "EUR" ? "🇪🇺"
      : base === "GBP" ? "🇬🇧"
        : base === "AUD" ? "🇦🇺"
          : base === "JPY" ? "🇯🇵"
            : category === "METALS" ? "◈"
              : category === "CRYPTO" ? "◆" : "◎";

  return {
    symbol,
    name: `${CURRENCY_NAMES[base] || base} / ${CURRENCY_NAMES[quote] || quote}`,
    category,
    flag
  };
});

export function numeric(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

export function formatPrice(value: string | number | undefined, symbol = ""): string {
  const parsed = typeof value === "number" ? value : numeric(value);
  if (parsed === null) return "—";
  const digits = symbol.endsWith("JPY") ? 3 : parsed >= 1000 ? 2 : parsed >= 10 ? 4 : 5;
  return parsed.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatChange(value: string | undefined): string {
  const parsed = numeric(value);
  return parsed === null ? "—" : (parsed > 0 ? "+" : "") + parsed.toFixed(2) + "%";
}

export function formatTime(value: string | undefined): string {
  if (!value) return "Waiting for first update";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Timestamp unavailable"
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function getPrice(snapshot: MarketSnapshot | undefined): number | null {
  return numeric(snapshot?.buy);
}

import WebSocket from "ws";
import { env } from "../../config/env.js";
import { saveMarketTick } from "../persistence/market-tick.repository.js";

export const MARKET_SYMBOLS = [
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
  "AVXUSD",
] as const;

const SYMBOL_SET = new Set<string>(MARKET_SYMBOLS);
const MAX_RECONNECT_DELAY_MS = 30_000;
const AUTH_TIMEOUT_MS = 10_000;
const MAX_DEDUPE_KEYS = 50_000;
const dedupeKeys = new Set<string>();
const inFlightPersists = new Set<Promise<void>>();

let marketDataStopping = false;
let activeSocket: WebSocket | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let mockTimer: ReturnType<typeof setInterval> | undefined;
let reconnectAttempts = 0;
let mockTickNumber = 0;

function parseTimestamp(value: string | number | undefined): Date {
  if (value === undefined || value === "") return new Date();

  if (typeof value === "number" || (typeof value === "string" && /^\d+(\.\d+)?$/.test(value))) {
    const numeric = Number(value);
    // Unix timestamps from providers may be in seconds or milliseconds.
    return new Date(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric);
  }

  return new Date(value);
}

function persistTick(symbol: string, bid: number, ask: number, timestamp: Date): void {
  const now = Date.now();
  const timestampMs = timestamp.getTime();
  if (!SYMBOL_SET.has(symbol)) {
    console.warn("Ignoring market tick for an unsubscribed symbol", { symbol });
    return;
  }
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0 || !Number.isFinite(timestampMs)) {
    console.warn("Ignoring invalid market tick", { symbol });
    return;
  }
  if (timestampMs > now) {
    console.warn("Ignoring market tick with a future timestamp", { symbol, timestamp: timestamp.toISOString() });
    return;
  }
  if (timestampMs < now - 24 * 60 * 60 * 1000) {
    console.warn("Ignoring market tick older than the rolling 24-hour window", { symbol });
    return;
  }

  const fingerprint = `${symbol}|${timestampMs}|${bid}|${ask}`;
  if (dedupeKeys.has(fingerprint)) return;
  dedupeKeys.add(fingerprint);
  if (dedupeKeys.size > MAX_DEDUPE_KEYS) {
    const oldest = dedupeKeys.values().next().value as string | undefined;
    if (oldest) dedupeKeys.delete(oldest);
  }

  const persist = saveMarketTick({ symbol, buy: bid, sell: ask, timestamp })
    .catch((error: unknown) => {
      if (!marketDataStopping) console.error("Failed to persist market tick:", error);
    })
    .finally(() => inFlightPersists.delete(persist));
  inFlightPersists.add(persist);
}

function startMockFeed(): void {
  if (mockTimer) clearInterval(mockTimer);
  console.warn("MARKET_DATA_MODE=mock: generating synthetic prices; these are not live market data.");

  mockTimer = setInterval(() => {
    if (marketDataStopping) return;
    const timestamp = new Date();
    mockTickNumber += 1;

    for (let index = 0; index < MARKET_SYMBOLS.length; index += 1) {
      const symbol = MARKET_SYMBOLS[index]!;
      const base = 0.75 + index * 0.37;
      const movement = Math.sin((mockTickNumber + index) / 7) * base * 0.0005;
      const bid = Number((base + movement).toFixed(8));
      const ask = Number((bid + Math.max(base * 0.00005, 0.00001)).toFixed(8));
      persistTick(symbol, bid, ask, timestamp);
    }
  }, 1_000);
  mockTimer.unref();
}

function scheduleReconnect(): void {
  if (marketDataStopping || reconnectTimer) return;
  reconnectAttempts += 1;
  const exponential = Math.min(1_000 * 2 ** Math.min(reconnectAttempts - 1, 5), MAX_RECONNECT_DELAY_MS);
  const delay = Math.min(MAX_RECONNECT_DELAY_MS, Math.round(exponential * (0.8 + Math.random() * 0.4)));
  console.warn(`Reconnecting to market data provider in ${delay}ms (attempt ${reconnectAttempts})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    openMarketSocket();
  }, delay);
  reconnectTimer.unref();
}

function openMarketSocket(): WebSocket {
  const ws = new WebSocket(env.MARKET_WS_URL);
  activeSocket = ws;
  let authenticated = false;
  let authTimer: ReturnType<typeof setTimeout> | undefined;

  ws.on("open", () => {
    if (marketDataStopping) {
      ws.close(1000, "Application shutting down");
      return;
    }
    console.log("Connected to market data provider");
    ws.send(JSON.stringify({
      action: "auth",
      api_key: env.MARKET_API_KEY,
      secret: env.MARKET_SECRET_KEY,
    }));
    authTimer = setTimeout(() => {
      if (!authenticated && ws.readyState === WebSocket.OPEN) {
        console.error("Market data authentication timed out");
        ws.terminate();
      }
    }, AUTH_TIMEOUT_MS);
    authTimer.unref();
  });

  ws.on("message", (rawData) => {
    let data: unknown;
    try {
      data = JSON.parse(rawData.toString());
    } catch {
      console.error("Received invalid JSON from market data provider");
      return;
    }

    if (typeof data !== "object" || data === null) return;

    if ("event" in data && data.event === "authenticated") {
      if (!("success" in data) || data.success !== true) {
        console.error("Market data authentication was rejected");
        ws.close(1008, "Authentication rejected");
        return;
      }
      if (authenticated) return;
      authenticated = true;
      reconnectAttempts = 0;
      if (authTimer) clearTimeout(authTimer);
      ws.send(JSON.stringify({
        action: "subscribeMarketPrice",
        symbols: MARKET_SYMBOLS,
      }));
      console.log(`Market price subscription requested for ${MARKET_SYMBOLS.length} symbols`);
      return;
    }

    if (
      "event" in data &&
      (data.event === "marketPriceSnapshot" || data.event === "marketPriceUpdate") &&
      "symbol" in data && typeof data.symbol === "string" &&
      "bid" in data && typeof data.bid === "number" &&
      "ask" in data && typeof data.ask === "number"
    ) {
      if (!authenticated) {
        console.warn("Ignoring market data received before authentication");
        return;
      }
      const symbol = data.symbol.toUpperCase();
      const timestampValue =
        "timestamp" in data && (typeof data.timestamp === "string" || typeof data.timestamp === "number")
          ? data.timestamp
          : undefined;
      persistTick(symbol, data.bid, data.ask, parseTimestamp(timestampValue));
      return;
    }

    if ("event" in data && (data.event === "error" || data.event === "unauthorized")) {
      console.error("Market data provider returned an error event", { event: data.event });
    }
  });

  ws.on("error", (error) => {
    console.error("Market WebSocket error:", error.message);
  });

  ws.on("close", (code, reason) => {
    if (authTimer) clearTimeout(authTimer);
    if (activeSocket === ws) activeSocket = undefined;
    console.warn(`Market WebSocket closed: ${code} ${reason.toString()}`);
    scheduleReconnect();
  });

  return ws;
}

export function connectMarketData(): WebSocket | undefined {
  marketDataStopping = false;
  if (env.MARKET_DATA_MODE === "mock") {
    startMockFeed();
    return undefined;
  }
  if (!env.MARKET_API_KEY || !env.MARKET_SECRET_KEY) {
    throw new Error("Market API credentials are missing");
  }
  return openMarketSocket();
}

export async function closeMarketDataSocket(_socket?: WebSocket): Promise<void> {
  marketDataStopping = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  if (mockTimer) clearInterval(mockTimer);
  mockTimer = undefined;

  const socket = activeSocket;
  activeSocket = undefined;
  if (socket && socket.readyState !== WebSocket.CLOSED) {
    await new Promise<void>((resolve) => {
      const finish = () => resolve();
      socket.once("close", finish);
      if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
      else socket.close(1000, "Application shutting down");
      const forceClose = setTimeout(() => {
        socket.terminate();
        resolve();
      }, 2_000);
      forceClose.unref();
      socket.once("close", () => clearTimeout(forceClose));
    });
  }

  while (inFlightPersists.size > 0) {
    await Promise.allSettled([...inFlightPersists]);
  }
}

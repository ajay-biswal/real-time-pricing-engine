import WebSocket from "ws";
import { env } from "../../config/env.js";
import { saveMarketTick } from "../persistence/market-tick.repository.js";

const MARKET_SYMBOLS = [
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
];

let marketDataStopping = false;
const inFlightPersists = new Set<Promise<void>>();

export async function closeMarketDataSocket(
  socket: WebSocket | undefined,
): Promise<void> {
  marketDataStopping = true;
  if (socket && socket.readyState !== WebSocket.CLOSED) {
    await new Promise<void>((resolve) => {
      if (socket.readyState === WebSocket.CLOSED) return resolve();
      socket.once("close", () => resolve());
      socket.close(1000, "Application shutting down");
    });
  }
  while (inFlightPersists.size > 0) {
    await Promise.allSettled([...inFlightPersists]);
  }
}

const timestampSamplesLogged: Record<string, number> = {};

export function connectMarketData(): WebSocket | undefined {
  marketDataStopping = false;

  if (!env.MARKET_API_KEY || !env.MARKET_SECRET_KEY) {
    throw new Error("Market API credentials are missing");
  }

  const ws = new WebSocket(env.MARKET_WS_URL);
  let authenticated = false;

  ws.on("open", () => {
    console.log("Connected to market data provider");
    ws.send(JSON.stringify({
      action: "auth",
      api_key: env.MARKET_API_KEY,
      secret: env.MARKET_SECRET_KEY,
    }));
    console.log("Market data authentication request sent");
  });

  ws.on("message", (rawData) => {
    const message = rawData.toString();
    let data: unknown;

    try {
      data = JSON.parse(message);
    } catch {
      console.error("Received invalid JSON from market data provider");
      return;
    }

    if (
      typeof data === "object" && data !== null &&
      "event" in data && data.event === "authenticated" &&
      "success" in data && data.success === true
    ) {
      if (authenticated) return;
      authenticated = true;
      console.log("Market data authentication successful");
      ws.send(JSON.stringify({
        action: "subscribeMarketPrice",
        symbols: MARKET_SYMBOLS,
      }));
      console.log(`Market price subscription request sent for ${MARKET_SYMBOLS.length} symbols`);
      return;
    }

    if (
      typeof data === "object" && data !== null &&
      "event" in data &&
      (data.event === "marketPriceSnapshot" || data.event === "marketPriceUpdate") &&
      "symbol" in data && "bid" in data && "ask" in data
    ) {
      const tick = data as {
        symbol: string;
        bid: number;
        ask: number;
        timestamp?: string | number;
      };

      const eventName = String(data.event);
      const sampleCount = timestampSamplesLogged[eventName] ?? 0;
      if (
        (eventName === "marketPriceSnapshot" || eventName === "marketPriceUpdate") &&
        sampleCount < 3
      ) {
        console.log("Provider market data diagnostic:", {
          event: eventName,
          payload: data,
          receivedAt: new Date().toISOString(),
        });

        timestampSamplesLogged[eventName] = sampleCount + 1;
      }

      const timestamp =
        tick.timestamp === undefined || tick.timestamp === null
          ? new Date()
          : new Date(tick.timestamp);

      if (
        typeof tick.symbol !== "string" ||
        typeof tick.bid !== "number" || typeof tick.ask !== "number" ||
        !Number.isFinite(tick.bid) || !Number.isFinite(tick.ask) ||
        Number.isNaN(timestamp.getTime())
      ) {
        console.error("Invalid market tick received");
        return;
      }
      if (marketDataStopping) return;

      const persist = saveMarketTick({
        symbol: tick.symbol,
        buy: tick.bid,
        sell: tick.ask,
        timestamp,
      })
        .catch((error: unknown) => {
          if (!marketDataStopping) console.error("Failed to persist market tick:", error);
        })
        .finally(() => inFlightPersists.delete(persist));

      inFlightPersists.add(persist);
      return;
    }

    console.log("Provider message:", data);
  });

  ws.on("error", (error) => {
    console.error("Market WebSocket error details:", {
      message: error.message,
      code: "code" in error ? error.code : undefined,
      stack: error.stack,
    });
  });

  ws.on("close", (code, reason) => {
    console.log(`Market WebSocket closed: ${code} ${reason.toString()}`);
  });

  return ws;
}

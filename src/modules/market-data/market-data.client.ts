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
let mockMarketDataTimer: ReturnType<typeof setInterval> | undefined;

export async function closeMarketDataSocket(
  socket: WebSocket | undefined,
): Promise<void> {
  marketDataStopping = true;
  if (mockMarketDataTimer) {
    clearInterval(mockMarketDataTimer);
    mockMarketDataTimer = undefined;
  }

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

function mockInitialPrice(symbol: string): number {
  if (symbol.startsWith("BTC")) return 65000;
  if (symbol.startsWith("ETH")) return 3200;
  if (symbol.startsWith("BNB")) return 580;
  if (symbol.startsWith("SOL")) return 150;
  if (symbol.startsWith("XAU")) return 2650;
  if (symbol.startsWith("XAG")) return 31;
  if (symbol.endsWith("JPY")) return 150;
  if (symbol.endsWith("TRY")) return 34;
  if (symbol.endsWith("ZAR")) return 18;
  if (symbol.endsWith("MXN")) return 18;
  if (symbol.endsWith("NOK") || symbol.endsWith("SEK")) return 10.5;
  if (symbol.endsWith("CNH")) return 7.2;
  if (symbol.endsWith("USD") || symbol.startsWith("USD")) return 1.08;
  return 1.25;
}

/**
 * Deterministic-shape synthetic feed for development and reproducible pipeline
 * validation. It is not real market data and must never be used for trading.
 */
function startMockMarketData(): void {
  const prices = new Map<string, number>(
    MARKET_SYMBOLS.map((symbol): [string, number] => [symbol, mockInitialPrice(symbol)]),
  );
  console.warn(
    `Starting MOCK market-data feed for ${MARKET_SYMBOLS.length} symbols; values are synthetic, not live market prices.`,
  );

  const publishBatch = () => {
    if (marketDataStopping) return;
    const timestamp = new Date();

    for (const symbol of MARKET_SYMBOLS) {
      const previous = prices.get(symbol) ?? mockInitialPrice(symbol);
      const volatility = /BTC|ETH|BNB|SOL|XRP|ADA|DOG|DOT|LTC|BCH|XLM|TRX|UNI|FIL|AVX/.test(symbol)
        ? 0.0008
        : 0.00008;
      const mid = Math.max(0.000001, previous * (1 + (Math.random() - 0.5) * volatility));
      prices.set(symbol, mid);

      const spread = mid * (symbol.endsWith("USD") && /BTC|ETH|BNB|SOL|XRP|ADA|DOG|DOT|LTC|BCH|XLM|TRX|UNI|FIL|AVX/.test(symbol)
        ? 0.0005
        : 0.00002);

      const persist = saveMarketTick({
        symbol,
        buy: mid - spread / 2,
        sell: mid + spread / 2,
        timestamp,
      })
        .catch((error: unknown) => {
          if (!marketDataStopping) {
            console.error(`Failed to accept mock tick for ${symbol}:`, error);
          }
        })
        .finally(() => inFlightPersists.delete(persist));

      inFlightPersists.add(persist);
    }
  };

  publishBatch();
  mockMarketDataTimer = setInterval(publishBatch, 1000);
}

export function connectMarketData(): WebSocket | undefined {
  marketDataStopping = false;

  if (env.MARKET_DATA_MODE === "mock") {
    startMockMarketData();
    return undefined;
  }

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

<<<<<<< Updated upstream
      const eventName = "event" in data ? String(data.event) : "unknown";
      const sampleCount = timestampSamplesLogged[eventName] ?? 0;
      if (
        (eventName === "marketPriceSnapshot" || eventName === "marketPriceUpdate") &&
=======
      const eventName =
        typeof data === "object" && data !== null && "event" in data
          ? String(data.event)
          : "unknown";

      const sampleCount = timestampSamplesLogged[eventName] ?? 0;

      if (
        (eventName === "marketPriceSnapshot" ||
          eventName === "marketPriceUpdate") &&
>>>>>>> Stashed changes
        sampleCount < 3
      ) {
        console.log("Provider market data diagnostic:", {
          event: eventName,
          payload: data,
          receivedAt: new Date().toISOString(),
        });
<<<<<<< Updated upstream
=======

>>>>>>> Stashed changes
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

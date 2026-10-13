import WebSocket from "ws";
import { env } from "../../config/env.js";

const MARKET_SYMBOLS = [
  "AUDUSD", "AUDCAD", "AUDCHF", "AUDJPY", "AUDNZD",
  "AUDSGD", "CADCHF", "CADJPY", "CHFJPY", "CHFSGD",
  "EURAUD", "EURCAD", "EURCHF", "EURGBP", "EURJPY",
  "EURNZD", "EURUSD", "GBPAUD", "GBPCAD", "GBPCHF",
  "GBPJPY", "GBPNZD", "GBPUSD", "NZDCAD", "NZDCHF",
  "NZDJPY", "NZDUSD", "USDCAD", "USDCHF", "USDCNH",
  "USDJPY", "USDMXN", "USDNOK", "USDPLN", "USDSEK",
  "USDSGD", "USDTRY", "USDZAR", "EURTRY", "GBPTRY",
  "NOKJPY", "SEKJPY", "SGDJPY", "ZARJPY", "XAUUSD",
  "XAGUSD", "BTCUSD", "ETHUSD", "BNBUSD", "SOLUSD",
  "XRPUSD", "ADAUSD", "DOGUSD", "DOTUSD", "LTCUSD",
  "BCHUSD", "XLMUSD", "TRXUSD", "UNIUSD", "FILUSD",
  "AVXUSD",
];

export function connectMarketData(): WebSocket {
  if (!env.MARKET_API_KEY || !env.MARKET_SECRET_KEY) {
    throw new Error("Market API credentials are missing");
  }

  const ws = new WebSocket(env.MARKET_WS_URL);

  ws.on("open", () => {
    console.log("Connected to market data provider");

    ws.send(
      JSON.stringify({
        action: "auth",
        api_key: env.MARKET_API_KEY,
        secret: env.MARKET_SECRET_KEY,
      }),
    );
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

    console.log("Provider message:", data);

    // Subscribe only after confirming successful authentication.
    // The actual authentication response format must be verified.
  });

  ws.on("error", (error) => {
    console.error("Market WebSocket error:", error.message);
  });

  ws.on("close", (code, reason) => {
    console.log(
      `Market WebSocket closed: ${code} ${reason.toString()}`,
    );
  });

  return ws;
}
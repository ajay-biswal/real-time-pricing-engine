import { WebSocket, WebSocketServer } from "ws";
import type { Server } from "node:http";
import { redisClient } from "../../config/redis.js";

const SNAPSHOT_CHANNEL = "market:snapshot:updates";
const MAX_SYMBOLS_PER_CLIENT = 100;
const MAX_REQUEST_SYMBOLS = 100;
const MAX_CLIENT_BUFFER_BYTES = 1_000_000;
const MAX_INBOUND_PAYLOAD_BYTES = 16 * 1024;

interface ClientMessage {
  action: "subscribe" | "unsubscribe";
  symbols: string[];
}

interface MarketSnapshot {
  symbol: string;
  buy: string;
  sell: string;
  high24h: string;
  low24h: string;
  change24h: string;
  updatedAt: string;
  publishedAt?: string;
}

const clientSubscriptions = new Map<WebSocket, Set<string>>();
let clientWss: WebSocketServer | undefined;
let redisSubscriber: ReturnType<typeof redisClient.duplicate> | undefined;

function sendJson(client: WebSocket, payload: unknown): void {
  if (client.readyState !== WebSocket.OPEN) return;

  if (client.bufferedAmount > MAX_CLIENT_BUFFER_BYTES) {
    console.warn("Closing slow market WebSocket consumer", {
      bufferedBytes: client.bufferedAmount,
    });
    client.close(1013, "Client cannot keep up with market updates");
    return;
  }

  try {
    client.send(JSON.stringify(payload), (error) => {
      if (error) {
        console.error("Failed to send market WebSocket message:", error.message);
        client.terminate();
      }
    });
  } catch (error) {
    console.error("Failed to send market WebSocket message:", error);
    client.terminate();
  }
}

function parseSnapshot(message: string): MarketSnapshot | undefined {
  try {
    const value: unknown = JSON.parse(message);
    if (typeof value !== "object" || value === null) return undefined;
    if (
      !("symbol" in value) || typeof value.symbol !== "string" ||
      !("buy" in value) || typeof value.buy !== "string" ||
      !("sell" in value) || typeof value.sell !== "string" ||
      !("high24h" in value) || typeof value.high24h !== "string" ||
      !("low24h" in value) || typeof value.low24h !== "string" ||
      !("change24h" in value) || typeof value.change24h !== "string" ||
      !("updatedAt" in value) || typeof value.updatedAt !== "string"
    ) return undefined;
    return value as MarketSnapshot;
  } catch {
    return undefined;
  }
}

export async function attachClientWebSocket(server: Server): Promise<void> {
  if (clientWss) {
    throw new Error("Client WebSocket server is already attached");
  }

  const subscriber = redisClient.duplicate();
  redisSubscriber = subscriber;
  subscriber.on("error", (error) => {
    console.error("Redis subscriber error:", error.message);
  });

  try {
    await subscriber.connect();
    await subscriber.subscribe(SNAPSHOT_CHANNEL, (message) => {
      const snapshot = parseSnapshot(message);
      if (!snapshot) {
        console.error("Invalid snapshot received from Redis Pub/Sub");
        return;
      }

      const payload = { event: "marketPriceUpdate", data: snapshot };
      for (const [client, symbols] of clientSubscriptions) {
        if (symbols.has(snapshot.symbol)) sendJson(client, payload);
      }
    });

    const wss = new WebSocketServer({
      server,
      path: "/ws",
      maxPayload: MAX_INBOUND_PAYLOAD_BYTES,
      perMessageDeflate: false,
    });
    clientWss = wss;

    wss.on("connection", (client) => {
      clientSubscriptions.set(client, new Set());
      console.log("Client connected to market WebSocket");

      client.on("message", async (rawData) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawData.toString());
        } catch {
          sendJson(client, { event: "error", message: "Invalid JSON" });
          return;
        }

        if (
          typeof parsed !== "object" || parsed === null ||
          !("action" in parsed) || !("symbols" in parsed)
        ) {
          sendJson(client, { event: "error", message: "Invalid subscription request" });
          return;
        }

        const message = parsed as ClientMessage;
        if (
          !["subscribe", "unsubscribe"].includes(message.action) ||
          !Array.isArray(message.symbols) ||
          message.symbols.length > MAX_REQUEST_SYMBOLS ||
          message.symbols.some((symbol) =>
            typeof symbol !== "string" || symbol.trim().length === 0 || symbol.length > 20
          )
        ) {
          sendJson(client, {
            event: "error",
            message: `Invalid subscription request; provide at most ${MAX_REQUEST_SYMBOLS} valid symbols`,
          });
          return;
        }

        const subscriptions = clientSubscriptions.get(client);
        if (!subscriptions) return;

        const symbols = [...new Set(message.symbols.map((symbol) => symbol.trim().toUpperCase()))];
        if (message.action === "unsubscribe") {
          for (const symbol of symbols) subscriptions.delete(symbol);
          sendJson(client, { event: "unsubscribed", symbols });
          return;
        }

        const newSymbols = symbols.filter((symbol) => !subscriptions.has(symbol));
        if (subscriptions.size + newSymbols.length > MAX_SYMBOLS_PER_CLIENT) {
          sendJson(client, {
            event: "error",
            message: `Maximum ${MAX_SYMBOLS_PER_CLIENT} symbol subscriptions allowed`,
          });
          return;
        }

        for (const symbol of symbols) subscriptions.add(symbol);

        // Register subscriptions before reading cache to minimize the chance of missing live updates.
        for (const symbol of symbols) {
          try {
            const cached = await redisClient.get(`market:snapshot:${symbol}`);
            const snapshot = cached ? parseSnapshot(cached) : undefined;
            if (snapshot) {
              sendJson(client, { event: "marketPriceSnapshot", data: snapshot });
            }
          } catch (error) {
            console.error(`Failed to read cached snapshot for ${symbol}:`, error);
          }
        }

        sendJson(client, { event: "subscribed", symbols });
      });

      client.on("close", () => {
        clientSubscriptions.delete(client);
        console.log("Client disconnected from market WebSocket");
      });
      client.on("error", (error) => {
        console.error("Client WebSocket error:", error.message);
      });
    });

    wss.on("error", (error) => {
      console.error("Client WebSocket server error:", error.message);
    });

    console.log("Client WebSocket server attached at /ws");
  } catch (error) {
    redisSubscriber = undefined;
    if (subscriber.isOpen) await subscriber.quit().catch(() => undefined);
    throw error;
  }
}

export async function closeClientWebSocket(): Promise<void> {
  const wss = clientWss;
  clientWss = undefined;

  if (wss) {
    for (const client of wss.clients) {
      client.close(1001, "Server shutting down");
    }

    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
  }

  const subscriber = redisSubscriber;
  redisSubscriber = undefined;
  if (subscriber?.isOpen) await subscriber.quit();
  clientSubscriptions.clear();
}

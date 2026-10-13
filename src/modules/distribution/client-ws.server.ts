import { WebSocket, WebSocketServer } from "ws";
import type { Server } from "node:http";
import { redisClient } from "../../config/redis.js";

const SNAPSHOT_CHANNEL = "market:snapshot:updates";
const MAX_SYMBOLS_PER_CLIENT = 100;

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
}

const clientSubscriptions = new Map<WebSocket, Set<string>>();
let clientWss: WebSocketServer | undefined;
function createRedisSubscriber() {
  return redisClient.duplicate();
}

let redisSubscriber: ReturnType<typeof createRedisSubscriber> | undefined;

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
      let snapshot: MarketSnapshot;

      try {
        snapshot = JSON.parse(message) as MarketSnapshot;
        if (
          typeof snapshot.symbol !== "string" ||
          typeof snapshot.buy !== "string" ||
          typeof snapshot.sell !== "string"
        ) {
          throw new Error("Invalid snapshot shape");
        }
      } catch {
        console.error("Invalid snapshot received from Redis Pub/Sub");
        return;
      }

      const payload = JSON.stringify({ event: "marketPriceUpdate", data: snapshot });
      for (const [client, symbols] of clientSubscriptions) {
        if (client.readyState === WebSocket.OPEN && symbols.has(snapshot.symbol)) {
          client.send(payload);
        }
      }
    });

    const wss = new WebSocketServer({ server, path: "/ws" });
    clientWss = wss;

    wss.on("connection", (client) => {
      clientSubscriptions.set(client, new Set());
      console.log("Client connected to market WebSocket");

      client.on("message", async (rawData) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawData.toString());
        } catch {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ event: "error", message: "Invalid JSON" }));
          }
          return;
        }

        if (
          typeof parsed !== "object" ||
          parsed === null ||
          !("action" in parsed) ||
          !("symbols" in parsed)
        ) {
          client.send(JSON.stringify({ event: "error", message: "Invalid subscription request" }));
          return;
        }

        const message = parsed as ClientMessage;
        if (
          !["subscribe", "unsubscribe"].includes(message.action) ||
          !Array.isArray(message.symbols) ||
          message.symbols.some((symbol) => typeof symbol !== "string" || symbol.length === 0 || symbol.length > 20)
        ) {
          client.send(JSON.stringify({ event: "error", message: "Invalid subscription request" }));
          return;
        }

        const subscriptions = clientSubscriptions.get(client);
        if (!subscriptions) return;

        const symbols = [...new Set(message.symbols.map((symbol) => symbol.toUpperCase()))];
        if (message.action === "unsubscribe") {
          for (const symbol of symbols) subscriptions.delete(symbol);
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ event: "unsubscribed", symbols }));
          }
          return;
        }

        const newSymbols = symbols.filter((symbol) => !subscriptions.has(symbol));
        if (subscriptions.size + newSymbols.length > MAX_SYMBOLS_PER_CLIENT) {
          client.send(JSON.stringify({
            event: "error",
            message: `Maximum ${MAX_SYMBOLS_PER_CLIENT} symbol subscriptions allowed`,
          }));
          return;
        }

        for (const symbol of symbols) subscriptions.add(symbol);

        // Read cache after registering subscriptions so live updates are not missed.
        for (const symbol of symbols) {
          try {
            const cached = await redisClient.get(`market:snapshot:${symbol}`);
            if (cached && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({
                event: "marketPriceSnapshot",
                data: JSON.parse(cached) as MarketSnapshot,
              }));
            }
          } catch (error) {
            console.error(`Failed to read cached snapshot for ${symbol}:`, error);
          }
        }

        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ event: "subscribed", symbols }));
        }
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
  if (subscriber?.isOpen) {
    await subscriber.quit();
  }

  clientSubscriptions.clear();
}

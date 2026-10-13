import { WebSocket, WebSocketServer } from "ws";
import type { Server } from "node:http";
import { redisClient } from "../../config/redis.js";

const SNAPSHOT_CHANNEL = "market:snapshot:updates";

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

export async function attachClientWebSocket(
  server: Server,
): Promise<void> {
  const subscriber = redisClient.duplicate();

  subscriber.on("error", (error) => {
    console.error("Redis subscriber error:", error.message);
  });

  await subscriber.connect();

  await subscriber.subscribe(
    SNAPSHOT_CHANNEL,
    (message) => {
      let snapshot: MarketSnapshot;

      try {
        snapshot = JSON.parse(message) as MarketSnapshot;
      } catch {
        console.error("Invalid snapshot received from Redis Pub/Sub");
        return;
      }

      for (const [client, symbols] of clientSubscriptions) {
        if (
          client.readyState === WebSocket.OPEN &&
          symbols.has(snapshot.symbol)
        ) {
          client.send(
            JSON.stringify({
              event: "marketPriceUpdate",
              data: snapshot,
            }),
          );
        }
      }
    },
  );

  

  const wss = new WebSocketServer({
    server,
    path: "/ws",
  });

  wss.on("connection", (client) => {
    clientSubscriptions.set(client, new Set());

    console.log("Client connected to market WebSocket");

    client.on("message", async (rawData) => {
      let message: ClientMessage;

      try {
        message = JSON.parse(rawData.toString()) as ClientMessage;
      } catch {
        client.send(
          JSON.stringify({
            event: "error",
            message: "Invalid JSON",
          }),
        );
        return;
      }

      if (
        !message ||
        !["subscribe", "unsubscribe"].includes(message.action) ||
        !Array.isArray(message.symbols) ||
        message.symbols.some(
          (symbol) => typeof symbol !== "string" || symbol.length > 20,
        )
      ) {
        client.send(
          JSON.stringify({
            event: "error",
            message: "Invalid subscription request",
          }),
        );
        return;
      }

      const subscriptions = clientSubscriptions.get(client);

      if (!subscriptions) {
        return;
      }

      const symbols = [
        ...new Set(message.symbols.map((symbol) => symbol.toUpperCase())),
      ];

      if (message.action === "unsubscribe") {
        for (const symbol of symbols) {
          subscriptions.delete(symbol);
        }

        client.send(
          JSON.stringify({
            event: "unsubscribed",
            symbols,
          }),
        );
        return;
      }

      for (const symbol of symbols) {
        subscriptions.add(symbol);

        try {
          const cached = await redisClient.get(
            `market:snapshot:${symbol}`,
          );

          if (cached && client.readyState === WebSocket.OPEN) {
            client.send(
              JSON.stringify({
                event: "marketPriceSnapshot",
                data: JSON.parse(cached) as MarketSnapshot,
              }),
            );
          }
        } catch (error) {
          console.error(
            `Failed to read cached snapshot for ${symbol}:`,
            error,
          );
        }
      }

      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            event: "subscribed",
            symbols,
          }),
        );
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
}

export async function closeClientWebSocket(): Promise<void> {
  if (clientWss) {
    for (const client of clientWss.clients) {
      client.close();
    }

    await new Promise<void>((resolve) => {
      clientWss!.close(() => resolve());
    });

    clientWss = undefined;
  }

  if (redisSubscriber?.isOpen) {
    await redisSubscriber.quit();
  }

  redisSubscriber = undefined;
  clientSubscriptions.clear();
}
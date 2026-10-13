import { createServer } from "node:http";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";
import { connectRedis, closeRedis } from "./config/redis.js";
import { closeMarketDataSocket, connectMarketData } from "./modules/market-data/market-data.client.js";
import { shutdownMarketTickRepository } from "./modules/persistence/market-tick.repository.js";
import WebSocket from "ws";
import {
  attachClientWebSocket,
  closeClientWebSocket,
} from "./modules/distribution/client-ws.server.js";

const server = createServer(app);
let marketDataSocket: WebSocket | undefined;
let shuttingDown = false;

async function closeDependencies(): Promise<void> {
  // Stop the provider and drain already-accepted persistence operations before
  // closing the repository's ingestion queue.
  await closeMarketDataSocket(marketDataSocket);
  await shutdownMarketTickRepository();

  // Snapshot refreshes must finish before their Redis connection is closed.
  await closeClientWebSocket();

  const results = await Promise.allSettled([
    closeRedis(),
    prisma.$disconnect(),
  ]);

  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Failed to close an application dependency:", result.reason);
    }
  }
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`${signal} received. Shutting down gracefully...`);

  const timeout = setTimeout(() => {
    console.error("Graceful shutdown timed out");
    process.exit(1);
  }, 10_000);
  timeout.unref();

  try {
    // Stop accepting new HTTP connections immediately. Closing WebSockets
    // below allows this promise to settle instead of waiting indefinitely.
    const serverClosed = new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    await closeDependencies();
    await serverClosed;

    console.log("Graceful shutdown complete");
    clearTimeout(timeout);
    process.exit(0);
  } catch (error) {
    console.error("Graceful shutdown failed:", error);
    clearTimeout(timeout);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    console.log("PostgreSQL connected successfully");

    await connectRedis();
    await attachClientWebSocket(server);

    marketDataSocket = connectMarketData();

    server.listen(env.PORT, "0.0.0.0", () => {
      console.log(`HTTP server listening on port ${env.PORT}`);
    });
  } catch (error) {
    console.error("Application startup failed:", error);
    await closeDependencies();
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

void main();

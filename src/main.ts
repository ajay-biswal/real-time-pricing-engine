import { createServer } from "node:http";
import { app } from "./app.js";
import { env } from "./config/env.js";
import {
  connectMongoDB,
  closeMongoDB,
} from "./config/mongodb.js";
import {
  connectRedis,
  closeRedis,
} from "./config/redis.js";

import { connectMarketData } from "./modules/market-data/market-data.client.js";

const server = createServer(app);

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received. Shutting down...`);

  server.close(async () => {
    await Promise.allSettled([
      closeMongoDB(),
      closeRedis(),
    ]);

    process.exit(0);
  });

  setTimeout(() => {
    console.error("Graceful shutdown timed out");
    process.exit(1);
  }, 10_000).unref();
}

async function main(): Promise<void> {
  try {
    await connectMongoDB();
    await connectRedis();

    server.listen(env.PORT, "0.0.0.0", () => {
      console.log(`HTTP server listening on port ${env.PORT}`);
    });
  } catch (error) {
    console.error("Application startup failed:", error);

    await Promise.allSettled([
      closeMongoDB(),
      closeRedis(),
    ]);

    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

void main();
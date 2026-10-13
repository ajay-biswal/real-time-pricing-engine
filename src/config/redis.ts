import { createClient } from "redis";
import { env } from "./env.js";

export const redisClient = createClient({
  url: env.REDIS_URL,
});

redisClient.on("error", (error) => {
  console.error("Redis client error:", error.message);
});

export async function connectRedis(): Promise<void> {
  if (redisClient.isOpen) {
    return;
  }

  await redisClient.connect();

  await redisClient.ping();

  console.log("Redis connected successfully");
}

export async function closeRedis(): Promise<void> {
  if (redisClient.isOpen) {
    await redisClient.quit();
  }
}
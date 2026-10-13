import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  MARKET_WS_URL: z.string().url(),

  MARKET_API_KEY: z.string().default(""),
  MARKET_SECRET_KEY: z.string().default(""),

  MONGODB_URI: z.string().url(),
  MONGODB_DATABASE: z.string().min(1),

  DATABASE_URL: z.string().url(),

  REDIS_URL: z.string().url(),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error("Invalid environment configuration:");
  console.error(result.error.issues);
  process.exit(1);
}

export const env = result.data;
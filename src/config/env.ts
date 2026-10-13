import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  MARKET_DATA_MODE: z.enum(["live", "mock"]).default("live"),
  MARKET_WS_URL: z.string().url(),
  MARKET_API_KEY: z.string().default(""),
  MARKET_SECRET_KEY: z.string().default(""),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  ADMIN_API_KEY: z.string().default(""),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must contain at least 32 characters"),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error("Invalid environment configuration:");
  console.error(result.error.issues);
  process.exit(1);
}

export const env = result.data;

import pg from "pg";
import { env } from "./env.js";

const { Pool } = pg;

export const postgresPool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

postgresPool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error.message);
});

export async function connectPostgres(): Promise<void> {
  const client = await postgresPool.connect();

  try {
    await client.query("SELECT 1");
    console.log("PostgreSQL connected successfully");
  } finally {
    client.release();
  }
}

export async function closePostgres(): Promise<void> {
  await postgresPool.end();
}
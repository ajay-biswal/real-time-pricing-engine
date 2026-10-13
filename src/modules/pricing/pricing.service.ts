import { prisma } from "../../config/prisma.js";
import { redisClient } from "../../config/redis.js";

const SNAPSHOT_CHANNEL = "market:snapshot:updates";

/**
 * Recalculate a symbol's rolling 24-hour metrics in one PostgreSQL statement.
 * The database remains the source of truth, including after a process restart.
 */
export async function updateMarketSnapshot(symbol: string): Promise<void> {
  const rows = await prisma.$queryRaw<
    Array<{
      symbol: string;
      buy: string | number | { toString(): string };
      sell: string | number | { toString(): string };
      high24h: string | number | { toString(): string };
      low24h: string | number | { toString(): string };
      change24h: string | number | { toString(): string };
      updatedAt: Date;
    }>
  >`
    WITH bounds AS (
      SELECT NOW() AS window_end, NOW() - INTERVAL '24 hours' AS window_start
    ),
    latest AS (
      SELECT t.buy, t.sell, t.timestamp
      FROM "MarketTick" t, bounds b
      WHERE t.symbol = ${symbol} AND t.timestamp <= b.window_end
      ORDER BY t.timestamp DESC, t.id DESC
      LIMIT 1
    ),
    first_tick AS (
      SELECT t.buy
      FROM "MarketTick" t, bounds b
      WHERE t.symbol = ${symbol}
        AND t.timestamp >= b.window_start
        AND t.timestamp <= b.window_end
      ORDER BY t.timestamp ASC, t.id ASC
      LIMIT 1
    ),
    range_24h AS (
      SELECT MAX(t.buy) AS high, MIN(t.buy) AS low
      FROM "MarketTick" t, bounds b
      WHERE t.symbol = ${symbol}
        AND t.timestamp >= b.window_start
        AND t.timestamp <= b.window_end
    ),
    calculated AS (
      SELECT l.buy, l.sell, l.timestamp, r.high, r.low,
        CASE
          WHEN f.buy IS NULL OR f.buy = 0 THEN 0
          ELSE ((l.buy - f.buy) / f.buy) * 100
        END AS change
      FROM latest l
      CROSS JOIN range_24h r
      LEFT JOIN first_tick f ON TRUE
      WHERE r.high IS NOT NULL AND r.low IS NOT NULL
    )
    INSERT INTO "MarketSnapshot"
      ("symbol", "buy", "sell", "high24h", "low24h", "change24h", "updatedAt")
    SELECT ${symbol}, buy, sell, high, low, change, timestamp
    FROM calculated
    ON CONFLICT ("symbol") DO UPDATE SET
      "buy" = EXCLUDED."buy",
      "sell" = EXCLUDED."sell",
      "high24h" = EXCLUDED."high24h",
      "low24h" = EXCLUDED."low24h",
      "change24h" = EXCLUDED."change24h",
      "updatedAt" = EXCLUDED."updatedAt"
    RETURNING "symbol", "buy", "sell", "high24h", "low24h", "change24h", "updatedAt"
  `;

  const snapshot = rows[0];
  if (!snapshot) return;

  const message = JSON.stringify({
    // Wall-clock marker lets a local benchmark client measure publish-to-receive
    // latency. It is diagnostic metadata, not a persisted market timestamp.
    publishedAt: new Date().toISOString(),
    symbol: snapshot.symbol,
    buy: snapshot.buy.toString(),
    sell: snapshot.sell.toString(),
    high24h: snapshot.high24h.toString(),
    low24h: snapshot.low24h.toString(),
    change24h: snapshot.change24h.toString(),
    updatedAt: snapshot.updatedAt.toISOString(),
  });

  try {
    await redisClient.set(`market:snapshot:${symbol}`, message);
    await redisClient.publish(SNAPSHOT_CHANNEL, message);
  } catch (error) {
    // PostgreSQL remains authoritative; a later refresh can repair Redis.
    console.error(`Failed to cache or publish snapshot for ${symbol}:`, error);
  }
}

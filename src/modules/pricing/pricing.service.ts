import { prisma } from "../../config/prisma.js";
import { redisClient } from "../../config/redis.js";

const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function updateMarketSnapshot(
  symbol: string,
): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MS);

  const [latestTick, firstTick, priceRange] = await Promise.all([
    prisma.marketTick.findFirst({
      where: { symbol, timestamp: { lte: now } },
      orderBy: [{ timestamp: "desc" }, { id: "desc" }],
      select: {
        buy: true,
        sell: true,
        timestamp: true,
      },
    }),

    prisma.marketTick.findFirst({
      where: {
        symbol,
        timestamp: { gte: windowStart, lte: now },
      },
      orderBy: [{ timestamp: "asc" }, { id: "asc" }],
      select: { buy: true },
    }),

    prisma.marketTick.aggregate({
      where: {
        symbol,
        timestamp: { gte: windowStart, lte: now },
      },
      _max: { buy: true },
      _min: { buy: true },
    }),
  ]);

  if (
    !latestTick ||
    !firstTick ||
    priceRange._max.buy === null ||
    priceRange._min.buy === null
  ) {
    return;
  }

  const firstPrice = Number(firstTick.buy);
  const latestPrice = Number(latestTick.buy);

  const change24h =
    firstPrice === 0
      ? 0
      : ((latestPrice - firstPrice) / firstPrice) * 100;

  const snapshot = await prisma.marketSnapshot.upsert({
    where: { symbol },
    create: {
      symbol,
      buy: latestTick.buy,
      sell: latestTick.sell,
      high24h: priceRange._max.buy,
      low24h: priceRange._min.buy,
      change24h,
      updatedAt: latestTick.timestamp,
    },
    update: {
      buy: latestTick.buy,
      sell: latestTick.sell,
      high24h: priceRange._max.buy,
      low24h: priceRange._min.buy,
      change24h,
      updatedAt: latestTick.timestamp,
    },
  });

  try {
    await redisClient.set(
      `market:snapshot:${symbol}`,
      JSON.stringify({
        symbol: snapshot.symbol,
        buy: snapshot.buy.toString(),
        sell: snapshot.sell.toString(),
        high24h: snapshot.high24h.toString(),
        low24h: snapshot.low24h.toString(),
        change24h: snapshot.change24h.toString(),
        updatedAt: snapshot.updatedAt.toISOString(),
      }),
    );
  } catch (error) {
    console.error(`Failed to cache snapshot for ${symbol}:`, error);
  }
}
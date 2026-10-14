import { prisma } from "../../config/prisma.js";
import { redisClient } from "../../config/redis.js";
import { RollingPricingWindow, type PricingTick } from "./rolling-pricing-window.js";

const SNAPSHOT_CHANNEL = "market:snapshot:updates";

export type { PricingTick } from "./rolling-pricing-window.js";

export interface PricingSnapshot {
  symbol: string;
  buy: string;
  sell: string;
  high24h: string;
  low24h: string;
  change24h: string;
  updatedAt: string;
  publishedAt: string;
}

const states = new Map<string, RollingPricingWindow>();
const publishQueues = new Map<string, Promise<void>>();
let initialized = false;

function windowFor(symbol: string): RollingPricingWindow {
  let state = states.get(symbol);
  if (!state) {
    state = new RollingPricingWindow(symbol);
    states.set(symbol, state);
  }
  return state;
}

function toSnapshot(values: NonNullable<ReturnType<RollingPricingWindow["snapshot"]>>): PricingSnapshot {
  return {
    symbol: values.symbol,
    buy: String(values.buy),
    sell: String(values.sell),
    high24h: String(values.high24h),
    low24h: String(values.low24h),
    change24h: String(values.change24h),
    updatedAt: values.updatedAt.toISOString(),
    publishedAt: new Date().toISOString(),
  };
}

/** Serialize Redis writes per symbol so an older asynchronous publish cannot overwrite a newer snapshot. */
async function publishSnapshot(snapshot: PricingSnapshot): Promise<void> {
  const previous = publishQueues.get(snapshot.symbol) ?? Promise.resolve();
  const current: Promise<void> = previous
    .catch(() => undefined)
    .then(async () => {
      const message = JSON.stringify(snapshot);
      await redisClient.set(`market:snapshot:${snapshot.symbol}`, message);
      await redisClient.publish(SNAPSHOT_CHANNEL, message);
    })
    .catch((error: unknown) => {
      console.error(`Failed to publish in-memory snapshot for ${snapshot.symbol}:`, error);
    });

  publishQueues.set(snapshot.symbol, current);
  void current.then(() => {
    if (publishQueues.get(snapshot.symbol) === current) {
      publishQueues.delete(snapshot.symbol);
    }
  });
  await current;
}

/**
 * Rebuild the rolling window from PostgreSQL before accepting provider updates.
 * Rows are loaded in deterministic event-time/id order to restore same-timestamp ordering.
 */
export async function initializePricingState(): Promise<void> {
  if (initialized) return;

  const now = new Date();
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const ticks = await prisma.marketTick.findMany({
    where: { timestamp: { gte: cutoff, lte: now } },
    orderBy: [{ symbol: "asc" }, { timestamp: "asc" }, { id: "asc" }],
    select: { symbol: true, buy: true, sell: true, timestamp: true },
  });

  for (const tick of ticks) {
    windowFor(tick.symbol).add({
      symbol: tick.symbol,
      buy: Number(tick.buy),
      sell: Number(tick.sell),
      timestamp: tick.timestamp,
    }, now.getTime());
  }

  // Repopulate Redis after a Redis restart, even when the provider has not ticked yet.
  for (const state of states.values()) {
    const snapshot = state.snapshot(now.getTime());
    if (snapshot) await publishSnapshot(toSnapshot(snapshot));
  }

  initialized = true;
  console.log(`Pricing state restored from PostgreSQL: ${ticks.length} ticks across ${states.size} symbols`);
}

/** Update memory synchronously, then publish without waiting on PostgreSQL. */
export function acceptPricingTick(tick: PricingTick): void {
  if (!initialized) {
    throw new Error("Pricing state must be initialized before accepting ticks");
  }
  const snapshot = windowFor(tick.symbol).add(tick);
  if (snapshot) void publishSnapshot(toSnapshot(snapshot));
}

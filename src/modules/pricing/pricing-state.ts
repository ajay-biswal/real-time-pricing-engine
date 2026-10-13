import { prisma } from "../../config/prisma.js";
import { redisClient } from "../../config/redis.js";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_CHANNEL = "market:snapshot:updates";

export interface PricingTick {
  symbol: string;
  buy: number;
  sell: number;
  timestamp: Date;
}

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

interface Entry extends PricingTick {
  sequence: number;
}

interface SymbolState {
  ticks: Entry[];
  head: number;
  highs: Entry[];
  highHead: number;
  lows: Entry[];
  lowHead: number;
  sequence: number;
  latest?: Entry;
}

const states = new Map<string, SymbolState>();
let initialized = false;

function stateFor(symbol: string): SymbolState {
  let state = states.get(symbol);
  if (!state) {
    state = { ticks: [], head: 0, highs: [], highHead: 0, lows: [], lowHead: 0, sequence: 0 };
    states.set(symbol, state);
  }
  return state;
}

function compact<T>(items: T[], head: number): { items: T[]; head: number } {
  if (head > 1024 && head * 2 >= items.length) return { items: items.slice(head), head: 0 };
  return { items, head };
}

function expire(state: SymbolState, cutoff: number): void {
  while (state.head < state.ticks.length && state.ticks[state.head]!.timestamp.getTime() < cutoff) {
    state.head++;
  }
  while (state.highHead < state.highs.length && state.highs[state.highHead]!.timestamp.getTime() < cutoff) {
    state.highHead++;
  }
  while (state.lowHead < state.lows.length && state.lows[state.lowHead]!.timestamp.getTime() < cutoff) {
    state.lowHead++;
  }

  const ticks = compact(state.ticks, state.head);
  state.ticks = ticks.items;
  state.head = ticks.head;
  const highs = compact(state.highs, state.highHead);
  state.highs = highs.items;
  state.highHead = highs.head;
  const lows = compact(state.lows, state.lowHead);
  state.lows = lows.items;
  state.lowHead = lows.head;
}

function addToState(tick: PricingTick): PricingSnapshot | undefined {
  const state = stateFor(tick.symbol);
  const entry: Entry = { ...tick, sequence: ++state.sequence };

  // A late/out-of-order tick is retained only if it belongs to the active window.
  // Provider samples currently omit timestamps, so receipt time is used upstream.
  state.ticks.push(entry);
  while (state.highs.length > state.highHead && state.highs[state.highs.length - 1]!.buy <= entry.buy) {
    state.highs.pop();
  }
  state.highs.push(entry);
  while (state.lows.length > state.lowHead && state.lows[state.lows.length - 1]!.buy >= entry.buy) {
    state.lows.pop();
  }
  state.lows.push(entry);

  if (!state.latest || entry.timestamp.getTime() > state.latest.timestamp.getTime() ||
      (entry.timestamp.getTime() === state.latest.timestamp.getTime() && entry.sequence > state.latest.sequence)) {
    state.latest = entry;
  }

  const now = Date.now();
  expire(state, now - WINDOW_MS);
  const first = state.ticks[state.head];
  const high = state.highs[state.highHead];
  const low = state.lows[state.lowHead];
  const latest = state.latest;

  if (!first || !high || !low || !latest) return undefined;
  const change = first.buy === 0 ? 0 : ((latest.buy - first.buy) / first.buy) * 100;

  return {
    symbol: tick.symbol,
    buy: String(latest.buy),
    sell: String(latest.sell),
    high24h: String(high.buy),
    low24h: String(low.buy),
    change24h: String(change),
    updatedAt: latest.timestamp.toISOString(),
    publishedAt: new Date().toISOString(),
  };
}

async function publishSnapshot(snapshot: PricingSnapshot): Promise<void> {
  const message = JSON.stringify(snapshot);
  try {
    await redisClient.set(`market:snapshot:${snapshot.symbol}`, message);
    await redisClient.publish(SNAPSHOT_CHANNEL, message);
  } catch (error) {
    console.error(`Failed to publish in-memory snapshot for ${snapshot.symbol}:`, error);
  }
}

/**
 * Rebuild the rolling window from PostgreSQL before accepting provider updates.
 * PostgreSQL remains the durable source; memory serves the latency-sensitive path.
 */
export async function initializePricingState(): Promise<void> {
  if (initialized) return;

  const cutoff = new Date(Date.now() - WINDOW_MS);
  const ticks = await prisma.marketTick.findMany({
    where: { timestamp: { gte: cutoff, lte: new Date() } },
    orderBy: [{ symbol: "asc" }, { timestamp: "asc" }, { id: "asc" }],
    select: { symbol: true, buy: true, sell: true, timestamp: true },
  });

  for (const tick of ticks) {
    addToState({
      symbol: tick.symbol,
      buy: Number(tick.buy),
      sell: Number(tick.sell),
      timestamp: tick.timestamp,
    });
  }

  // Repopulate Redis after a Redis restart, even when the provider has not ticked yet.
  for (const state of states.values()) {
    const latest = state.latest;
    if (!latest) continue;
    const first = state.ticks[state.head];
    const high = state.highs[state.highHead];
    const low = state.lows[state.lowHead];
    if (!first || !high || !low) continue;
    const change = first.buy === 0 ? 0 : ((latest.buy - first.buy) / first.buy) * 100;
    await publishSnapshot({
      symbol: latest.symbol,
      buy: String(latest.buy),
      sell: String(latest.sell),
      high24h: String(high.buy),
      low24h: String(low.buy),
      change24h: String(change),
      updatedAt: latest.timestamp.toISOString(),
      publishedAt: new Date().toISOString(),
    });
  }

  initialized = true;
  console.log(`Pricing state restored from PostgreSQL: ${ticks.length} ticks across ${states.size} symbols`);
}

/** Update memory synchronously, then publish without waiting on PostgreSQL. */
export function acceptPricingTick(tick: PricingTick): void {
  if (!initialized) {
    throw new Error("Pricing state must be initialized before accepting ticks");
  }
  const snapshot = addToState(tick);
  if (snapshot) void publishSnapshot(snapshot);
}

import { performance } from "node:perf_hooks";
import { prisma } from "../../config/prisma.js";
import {
  elapsedMs,
  ingestionLatency,
  snapshotLatency,
} from "../common/latency-metrics.js";
import { updateMarketSnapshot } from "../pricing/pricing.service.js";


export interface MarketTickInput {
  symbol: string;
  buy: number;
  sell: number;
  timestamp: Date;
}

interface PendingTick {
  tick: MarketTickInput;
  acceptedAt: number;
  resolve: () => void;
  reject: (error: unknown) => void;
}

const BATCH_INTERVAL_MS = 50;
const MAX_BATCH_SIZE = 250;
const SNAPSHOT_COALESCE_MS = 500;

const pendingTicks: PendingTick[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let flushPromise: Promise<void> | undefined;
let acceptingTicks = true;
const snapshotTimers = new Map<string, ReturnType<typeof setTimeout>>();
const snapshotInProgress = new Map<string, Promise<void>>();
const snapshotPending = new Set<string>();

export function saveMarketTick(tick: MarketTickInput): Promise<void> {
  if (!acceptingTicks) {
    return Promise.reject(new Error("Market tick ingestion is shutting down"));
  }

  const promise = new Promise<void>((resolve, reject) => {
    pendingTicks.push({ tick, acceptedAt: performance.now(), resolve, reject });
  });

  if (pendingTicks.length >= MAX_BATCH_SIZE) {
    clearFlushTimer();
    void flushPendingTicks();
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      void flushPendingTicks();
    }, BATCH_INTERVAL_MS);
  }

  return promise;
}

function clearFlushTimer(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = undefined;
}

async function flushPendingTicks(): Promise<void> {
  if (flushPromise) {
    await flushPromise;
    if (pendingTicks.length > 0) await flushPendingTicks();
    return;
  }
  if (pendingTicks.length === 0) return;

  flushPromise = (async () => {
    while (pendingTicks.length > 0) {
      const batch = pendingTicks.splice(0, MAX_BATCH_SIZE);
      try {
        await prisma.marketTick.createMany({
          data: batch.map(({ tick }) => ({
            symbol: tick.symbol,
            buy: tick.buy,
            sell: tick.sell,
            timestamp: tick.timestamp,
          })),
        });

        for (const item of batch) {
          ingestionLatency.record(elapsedMs(item.acceptedAt));
          item.resolve();
        }
        for (const symbol of new Set(batch.map(({ tick }) => tick.symbol))) {
          scheduleSnapshotRefresh(symbol);
        }
      } catch (error) {
        for (const item of batch) item.reject(error);
        console.error(`Failed to persist batch of ${batch.length} market ticks:`, error);
      }
    }
  })();

  try {
    await flushPromise;
  } finally {
    flushPromise = undefined;
  }

  if (pendingTicks.length > 0) await flushPendingTicks();
}

function scheduleSnapshotRefresh(symbol: string): void {
  const existing = snapshotTimers.get(symbol);
  if (existing) clearTimeout(existing);

  snapshotTimers.set(symbol, setTimeout(() => {
    snapshotTimers.delete(symbol);
    void refreshSnapshot(symbol);
  }, SNAPSHOT_COALESCE_MS));
}

async function refreshSnapshot(symbol: string): Promise<void> {
  const current = snapshotInProgress.get(symbol);
  if (current) {
    snapshotPending.add(symbol);
    await current;
    return;
  }

  const work = (async () => {
    do {
      snapshotPending.delete(symbol);
      const startedAt = performance.now();
      try {
        await updateMarketSnapshot(symbol);
      } catch (error) {
        console.error(`Failed to refresh market snapshot for ${symbol}:`, error);
      } finally {
        snapshotLatency.record(elapsedMs(startedAt));
      }
    } while (snapshotPending.has(symbol));
  })();

  snapshotInProgress.set(symbol, work);
  try {
    await work;
  } finally {
    snapshotInProgress.delete(symbol);
    if (snapshotPending.has(symbol)) await refreshSnapshot(symbol);
  }
}

/**
 * Stop accepting new ticks, persist all queued ticks, then refresh every
 * affected snapshot before Redis and PostgreSQL are disconnected.
 */
export async function shutdownMarketTickRepository(): Promise<void> {
  acceptingTicks = false;
  clearFlushTimer();

  await flushPendingTicks();

  for (const [symbol, timer] of snapshotTimers) {
    clearTimeout(timer);
    snapshotTimers.delete(symbol);
    snapshotPending.add(symbol);
  }

  const symbolsToRefresh = new Set([
    ...snapshotPending,
    ...snapshotInProgress.keys(),
  ]);

  await Promise.all([...symbolsToRefresh].map((symbol) => refreshSnapshot(symbol)));

  // A refresh may have been requested while another refresh was running.
  while (snapshotInProgress.size > 0 || snapshotPending.size > 0) {
    await Promise.all([...snapshotInProgress.values()]);
    const pending = [...snapshotPending];
    if (pending.length > 0) {
      await Promise.all(pending.map((symbol) => refreshSnapshot(symbol)));
    }
  }
}

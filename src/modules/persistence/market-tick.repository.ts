import { performance } from "node:perf_hooks";
import { prisma } from "../../config/prisma.js";
import {
  batchSizeMetrics,
  databaseBatchWriteLatency,
  elapsedMs,
  ingestionLatency,
  queueWaitLatency,
  recordFlushReason,
  snapshotLatency,
  type FlushReason,
} from "../common/latency-metrics.js";
import { acceptPricingTick } from "../pricing/pricing-state.js";

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
const SNAPSHOT_COALESCE_MS = 50;
const SLOW_DATABASE_BATCH_MS = 50;
const MAX_PENDING_TICKS = 10_000;

const pendingTicks: PendingTick[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let flushPromise: Promise<void> | undefined;
let acceptingTicks = true;

export function saveMarketTick(tick: MarketTickInput): Promise<void> {
  if (!acceptingTicks) {
    return Promise.reject(new Error("Market tick ingestion is shutting down"));
  }

  if (pendingTicks.length >= MAX_PENDING_TICKS) {
    return Promise.reject(new Error(`Market tick persistence queue is full (${MAX_PENDING_TICKS})`));
  }

  // Update the latency-sensitive pricing state before enqueueing durable storage.
  // The queue bound above prevents accepting an unbounded amount of work.
  acceptPricingTick(tick);

  const promise = new Promise<void>((resolve, reject) => {
    pendingTicks.push({ tick, acceptedAt: performance.now(), resolve, reject });
  });

  if (pendingTicks.length >= MAX_BATCH_SIZE) {
    clearFlushTimer();
    void flushPendingTicks("max-size");
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      void flushPendingTicks("timer");
    }, BATCH_INTERVAL_MS);
  }

  return promise;
}

function clearFlushTimer(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = undefined;
}

async function flushPendingTicks(reason: FlushReason = "drain"): Promise<void> {
  if (flushPromise) {
    await flushPromise;
    if (pendingTicks.length > 0) await flushPendingTicks("drain");
    return;
  }
  if (pendingTicks.length === 0) return;

  flushPromise = (async () => {
    while (pendingTicks.length > 0) {
      const batch = pendingTicks.splice(0, MAX_BATCH_SIZE);
      const batchStartedAt = performance.now();

      recordFlushReason(reason);
      batchSizeMetrics.record(batch.length);
      for (const item of batch) {
        queueWaitLatency.record(batchStartedAt - item.acceptedAt);
      }

      let dbDurationMs = 0;
      try {
        const dbStartedAt = performance.now();
        try {
          await prisma.marketTick.createMany({
            data: batch.map(({ tick }) => ({
              symbol: tick.symbol,
              buy: tick.buy,
              sell: tick.sell,
              timestamp: tick.timestamp,
            })),
          });
        } finally {
          // Includes Prisma/client overhead and the database round trip.
          dbDurationMs = elapsedMs(dbStartedAt);
          databaseBatchWriteLatency.record(dbDurationMs);

          if (dbDurationMs >= SLOW_DATABASE_BATCH_MS) {
            console.warn("Slow market tick database batch:", {
              durationMs: Number(dbDurationMs.toFixed(2)),
              batchSize: batch.length,
              flushReason: reason,
            });
          }
        }

        for (const item of batch) {
          ingestionLatency.record(elapsedMs(item.acceptedAt));
          item.resolve();
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

  if (pendingTicks.length > 0) await flushPendingTicks("drain");
}

/**
 * Stop accepting new ticks, persist all queued ticks, then refresh every
 * affected snapshot before Redis and PostgreSQL are disconnected.
 */
export async function shutdownMarketTickRepository(): Promise<void> {
  acceptingTicks = false;
  clearFlushTimer();

  await flushPendingTicks("shutdown");

  // Pricing snapshots are maintained in memory and published on tick arrival.
}

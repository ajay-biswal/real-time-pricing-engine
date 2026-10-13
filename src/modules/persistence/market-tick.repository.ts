import { performance } from "node:perf_hooks";
import { prisma } from "../../config/prisma.js";
import {
  batchSizeMetrics,
  databaseBatchWriteLatency,
  elapsedMs,
  ingestionLatency,
  queueWaitLatency,
  recordFlushReason,
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
const SLOW_DATABASE_BATCH_MS = 50;
const MAX_PENDING_TICKS = 10_000;
const MAX_DATABASE_ATTEMPTS = 3;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function writeBatchWithRetry(batch: PendingTick[]): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_DATABASE_ATTEMPTS; attempt += 1) {
    try {
      await prisma.marketTick.createMany({
        data: batch.map(({ tick }) => ({
          symbol: tick.symbol,
          buy: tick.buy,
          sell: tick.sell,
          timestamp: tick.timestamp,
        })),
        skipDuplicates: true,
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_DATABASE_ATTEMPTS) {
        await wait(100 * 2 ** (attempt - 1));
      }
    }
  }
  throw lastError;
}

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

  // Measure the synchronous hot path separately from the asynchronous database flush.
  const acceptedAt = performance.now();
  acceptPricingTick(tick);
  ingestionLatency.record(elapsedMs(acceptedAt));

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
          await writeBatchWithRetry(batch);
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

        for (const item of batch) item.resolve();
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
 * Stop accepting new ticks and drain queued persistence operations before
 * PostgreSQL is disconnected. Pricing snapshots are published on tick arrival.
 */
export async function shutdownMarketTickRepository(): Promise<void> {
  acceptingTicks = false;
  clearFlushTimer();

  await flushPendingTicks("shutdown");

  // Pricing snapshots are maintained in memory and published on tick arrival.
}

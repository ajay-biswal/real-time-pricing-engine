import { prisma } from "../../config/prisma.js";
import { updateMarketSnapshot } from "../pricing/pricing.service.js";

export interface MarketTickInput {
  symbol: string;
  buy: number;
  sell: number;
  timestamp: Date;
}

interface PendingTick {
  tick: MarketTickInput;
  resolve: () => void;
  reject: (error: unknown) => void;
}

const BATCH_INTERVAL_MS = 50;
const MAX_BATCH_SIZE = 250;
const SNAPSHOT_COALESCE_MS = 500;

const pendingTicks: PendingTick[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let flushInProgress = false;
const snapshotTimers = new Map<string, ReturnType<typeof setTimeout>>();
const snapshotInProgress = new Set<string>();
const snapshotPending = new Set<string>();

export function saveMarketTick(tick: MarketTickInput): Promise<void> {
  const promise = new Promise<void>((resolve, reject) => {
    pendingTicks.push({ tick, resolve, reject });
  });

  if (pendingTicks.length >= MAX_BATCH_SIZE) {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = undefined;
    void flushPendingTicks();
  } else if (!flushTimer && !flushInProgress) {
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      void flushPendingTicks();
    }, BATCH_INTERVAL_MS);
  }

  return promise;
}

async function flushPendingTicks(): Promise<void> {
  if (flushInProgress || pendingTicks.length === 0) return;
  flushInProgress = true;

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

    for (const item of batch) item.resolve();
    for (const symbol of new Set(batch.map(({ tick }) => tick.symbol))) {
      scheduleSnapshotRefresh(symbol);
    }
  } catch (error) {
    for (const item of batch) item.reject(error);
    console.error(`Failed to persist batch of ${batch.length} market ticks:`, error);
  } finally {
    flushInProgress = false;
    if (pendingTicks.length > 0) {
      if (pendingTicks.length >= MAX_BATCH_SIZE) {
        void flushPendingTicks();
      } else if (!flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = undefined;
          void flushPendingTicks();
        }, BATCH_INTERVAL_MS);
      }
    }
  }
}

function scheduleSnapshotRefresh(symbol: string): void {
  const existing = snapshotTimers.get(symbol);
  if (existing) clearTimeout(existing);

  // Coalesce bursts: refresh a symbol at most once per coalescing window.
  snapshotTimers.set(symbol, setTimeout(() => {
    snapshotTimers.delete(symbol);
    void refreshSnapshot(symbol);
  }, SNAPSHOT_COALESCE_MS));
}

async function refreshSnapshot(symbol: string): Promise<void> {
  if (snapshotInProgress.has(symbol)) {
    snapshotPending.add(symbol);
    return;
  }

  snapshotInProgress.add(symbol);
  try {
    await updateMarketSnapshot(symbol);
  } catch (error) {
    console.error(`Failed to refresh market snapshot for ${symbol}:`, error);
  } finally {
    snapshotInProgress.delete(symbol);
    if (snapshotPending.delete(symbol)) {
      void refreshSnapshot(symbol);
    }
  }
}

import { performance } from "node:perf_hooks";

const MAX_SAMPLES = 10_000;

export class LatencyMetrics {
  private samples: number[] = [];

  record(milliseconds: number): void {
    this.samples.push(milliseconds);

    if (this.samples.length > MAX_SAMPLES) {
      this.samples.shift();
    }
  }

  report(): {
    count: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    maxMs: number;
  } {
    const sorted = [...this.samples].sort((a, b) => a - b);

    if (sorted.length === 0) {
      return { count: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
    }

    const percentile = (p: number): number => {
      const index = Math.min(
        Math.ceil(p * sorted.length) - 1,
        sorted.length - 1,
      );

      return sorted[index] ?? 0;
    };

    return {
      count: sorted.length,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
      maxMs: sorted[sorted.length - 1] ?? 0,
    };
  }
}

export class NumericDistributionMetrics {
  private samples: number[] = [];

  record(value: number): void {
    this.samples.push(value);
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  report(): { count: number; p50: number; p95: number; p99: number; max: number } {
    const sorted = [...this.samples].sort((a, b) => a - b);
    if (sorted.length === 0) {
      return { count: 0, p50: 0, p95: 0, p99: 0, max: 0 };
    }

    const percentile = (p: number): number => {
      const index = Math.min(Math.ceil(p * sorted.length) - 1, sorted.length - 1);
      return sorted[index] ?? 0;
    };

    return {
      count: sorted.length,
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
      max: sorted[sorted.length - 1] ?? 0,
    };
  }
}

export const queueWaitLatency = new LatencyMetrics();
export const databaseBatchWriteLatency = new LatencyMetrics();
export const batchSizeMetrics = new NumericDistributionMetrics();
export const ingestionLatency = new LatencyMetrics();
export const snapshotLatency = new LatencyMetrics();

export type FlushReason = "timer" | "max-size" | "shutdown" | "drain";

const flushReasonCounts: Record<FlushReason, number> = {
  timer: 0,
  "max-size": 0,
  shutdown: 0,
  drain: 0,
};

export function recordFlushReason(reason: FlushReason): void {
  flushReasonCounts[reason] += 1;
}

export function reportFlushReasons(): Readonly<Record<FlushReason, number>> {
  return { ...flushReasonCounts };
}

export function elapsedMs(start: number): number {
  return performance.now() - start;
}

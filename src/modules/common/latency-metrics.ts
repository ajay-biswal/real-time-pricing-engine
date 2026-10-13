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

export const ingestionLatency = new LatencyMetrics();
export const snapshotLatency = new LatencyMetrics();

export function elapsedMs(start: number): number {
  return performance.now() - start;
}

export const PRICING_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface PricingTick {
  symbol: string;
  buy: number;
  sell: number;
  timestamp: Date;
}

export interface PricingValues {
  symbol: string;
  buy: number;
  sell: number;
  high24h: number;
  low24h: number;
  change24h: number;
  updatedAt: Date;
}

interface Entry extends PricingTick {
  sequence: number;
}

function compareTicks(a: Entry, b: Entry): number {
  const byTime = a.timestamp.getTime() - b.timestamp.getTime();
  return byTime || a.sequence - b.sequence;
}

/**
 * Keeps ticks ordered by event time. Monotonic deques make normal high/low
 * updates O(1); an out-of-order insertion rebuilds the deques for correctness.
 */
export class RollingPricingWindow {
  private ticks: Entry[] = [];
  private highs: Entry[] = [];
  private lows: Entry[] = [];
  private sequence = 0;

  constructor(
    readonly symbol: string,
    private readonly windowMs = PRICING_WINDOW_MS,
  ) {}

  add(tick: PricingTick, nowMs = Date.now()): PricingValues | undefined {
    if (tick.symbol !== this.symbol) throw new Error("Tick symbol does not match pricing window");
    const timestampMs = tick.timestamp.getTime();
    if (!Number.isFinite(timestampMs) || !Number.isFinite(tick.buy) || !Number.isFinite(tick.sell)) {
      throw new Error("Pricing tick contains invalid numeric values or timestamp");
    }

    const entry: Entry = { ...tick, sequence: ++this.sequence };
    const cutoff = nowMs - this.windowMs;
    const isOutOfOrder = this.ticks.length > 0 &&
      compareTicks(entry, this.ticks[this.ticks.length - 1]!) < 0;

    if (timestampMs >= cutoff && timestampMs <= nowMs) {
      if (isOutOfOrder) {
        const index = this.lowerBound(entry);
        this.ticks.splice(index, 0, entry);
      } else {
        this.ticks.push(entry);
      }
    }

    this.expire(cutoff);
    if (isOutOfOrder) this.rebuildExtrema();
    else this.appendExtrema(entry, cutoff);

    const first = this.ticks[0];
    const latest = this.ticks[this.ticks.length - 1];
    const high = this.highs[0];
    const low = this.lows[0];
    if (!first || !latest || !high || !low) return undefined;

    return {
      symbol: this.symbol,
      buy: latest.buy,
      sell: latest.sell,
      high24h: high.buy,
      low24h: low.buy,
      change24h: first.buy === 0 ? 0 : ((latest.buy - first.buy) / first.buy) * 100,
      updatedAt: latest.timestamp,
    };
  }

  snapshot(nowMs = Date.now()): PricingValues | undefined {
    this.expire(nowMs - this.windowMs);
    this.rebuildExtrema();
    const first = this.ticks[0];
    const latest = this.ticks[this.ticks.length - 1];
    const high = this.highs[0];
    const low = this.lows[0];
    if (!first || !latest || !high || !low) return undefined;

    return {
      symbol: this.symbol,
      buy: latest.buy,
      sell: latest.sell,
      high24h: high.buy,
      low24h: low.buy,
      change24h: first.buy === 0 ? 0 : ((latest.buy - first.buy) / first.buy) * 100,
      updatedAt: latest.timestamp,
    };
  }

  get size(): number {
    return this.ticks.length;
  }

  private lowerBound(entry: Entry): number {
    let low = 0;
    let high = this.ticks.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (compareTicks(this.ticks[mid]!, entry) < 0) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  private expire(cutoff: number): void {
    let count = 0;
    while (count < this.ticks.length && this.ticks[count]!.timestamp.getTime() < cutoff) count++;
    if (count > 0) this.ticks.splice(0, count);
    while (this.highs.length && this.highs[0]!.timestamp.getTime() < cutoff) this.highs.shift();
    while (this.lows.length && this.lows[0]!.timestamp.getTime() < cutoff) this.lows.shift();
  }

  private appendExtrema(entry: Entry, cutoff: number): void {
    if (entry.timestamp.getTime() < cutoff || entry.timestamp.getTime() > Date.now()) return;
    while (this.highs.length && this.highs[this.highs.length - 1]!.buy <= entry.buy) this.highs.pop();
    this.highs.push(entry);
    while (this.lows.length && this.lows[this.lows.length - 1]!.buy >= entry.buy) this.lows.pop();
    this.lows.push(entry);
  }

  private rebuildExtrema(): void {
    this.highs = [];
    this.lows = [];
    for (const entry of this.ticks) {
      while (this.highs.length && this.highs[this.highs.length - 1]!.buy <= entry.buy) this.highs.pop();
      this.highs.push(entry);
      while (this.lows.length && this.lows[this.lows.length - 1]!.buy >= entry.buy) this.lows.pop();
      this.lows.push(entry);
    }
  }
}

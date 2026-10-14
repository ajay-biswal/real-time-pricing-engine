export const PRICING_WINDOW_MS = 24 * 60 * 60 * 1000;
const COMPACT_THRESHOLD = 1_024;

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
 * Keeps ticks ordered by event time. Head-indexed arrays avoid O(n) shifts
 * during normal window expiry; out-of-order inserts rebuild the extrema deques.
 */
export class RollingPricingWindow {
  private ticks: Entry[] = [];
  private ticksHead = 0;
  private highs: Entry[] = [];
  private highsHead = 0;
  private lows: Entry[] = [];
  private lowsHead = 0;
  private sequence = 0;

  constructor(
    readonly symbol: string,
    private readonly windowMs = PRICING_WINDOW_MS,
  ) {}

  add(tick: PricingTick, nowMs = Date.now()): PricingValues | undefined {
    if (tick.symbol !== this.symbol) throw new Error("Tick symbol does not match pricing window");
    const timestampMs = tick.timestamp.getTime();
    if (
      !Number.isFinite(timestampMs) ||
      !Number.isFinite(tick.buy) ||
      !Number.isFinite(tick.sell) ||
      tick.buy <= 0 ||
      tick.sell <= 0
    ) {
      throw new Error("Pricing tick contains invalid numeric values or timestamp");
    }

    const entry: Entry = { ...tick, sequence: ++this.sequence };
    const cutoff = nowMs - this.windowMs;
    const last = this.ticks[this.ticks.length - 1];
    const isOutOfOrder = Boolean(last && compareTicks(entry, last) < 0);

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
    else this.appendExtrema(entry, cutoff, nowMs);

    return this.currentValues();
  }

  snapshot(nowMs = Date.now()): PricingValues | undefined {
    this.expire(nowMs - this.windowMs);
    this.rebuildExtrema();
    return this.currentValues();
  }

  get size(): number {
    return this.ticks.length - this.ticksHead;
  }

  private currentValues(): PricingValues | undefined {
    const first = this.ticks[this.ticksHead];
    const latest = this.ticks[this.ticks.length - 1];
    const high = this.highs[this.highsHead];
    const low = this.lows[this.lowsHead];
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

  private lowerBound(entry: Entry): number {
    let low = this.ticksHead;
    let high = this.ticks.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (compareTicks(this.ticks[mid]!, entry) < 0) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  private expire(cutoff: number): void {
    while (
      this.ticksHead < this.ticks.length &&
      this.ticks[this.ticksHead]!.timestamp.getTime() < cutoff
    ) this.ticksHead++;

    while (
      this.highsHead < this.highs.length &&
      this.highs[this.highsHead]!.timestamp.getTime() < cutoff
    ) this.highsHead++;

    while (
      this.lowsHead < this.lows.length &&
      this.lows[this.lowsHead]!.timestamp.getTime() < cutoff
    ) this.lowsHead++;

    this.compactIfNeeded();
  }

  private appendExtrema(entry: Entry, cutoff: number, nowMs: number): void {
    if (entry.timestamp.getTime() < cutoff || entry.timestamp.getTime() > nowMs) return;

    while (
      this.highs.length > this.highsHead &&
      this.highs[this.highs.length - 1]!.buy <= entry.buy
    ) this.highs.pop();
    this.highs.push(entry);

    while (
      this.lows.length > this.lowsHead &&
      this.lows[this.lows.length - 1]!.buy >= entry.buy
    ) this.lows.pop();
    this.lows.push(entry);
  }

  private rebuildExtrema(): void {
    this.highs = [];
    this.highsHead = 0;
    this.lows = [];
    this.lowsHead = 0;

    for (let index = this.ticksHead; index < this.ticks.length; index++) {
      const entry = this.ticks[index]!;
      while (this.highs.length && this.highs[this.highs.length - 1]!.buy <= entry.buy) {
        this.highs.pop();
      }
      this.highs.push(entry);

      while (this.lows.length && this.lows[this.lows.length - 1]!.buy >= entry.buy) {
        this.lows.pop();
      }
      this.lows.push(entry);
    }
  }

  private compactIfNeeded(): void {
    if (this.ticksHead >= COMPACT_THRESHOLD && this.ticksHead * 2 >= this.ticks.length) {
      this.ticks = this.ticks.slice(this.ticksHead);
      this.ticksHead = 0;
    }
    if (this.highsHead >= COMPACT_THRESHOLD && this.highsHead * 2 >= this.highs.length) {
      this.highs = this.highs.slice(this.highsHead);
      this.highsHead = 0;
    }
    if (this.lowsHead >= COMPACT_THRESHOLD && this.lowsHead * 2 >= this.lows.length) {
      this.lows = this.lows.slice(this.lowsHead);
      this.lowsHead = 0;
    }
  }
}

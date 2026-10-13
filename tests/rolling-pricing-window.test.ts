import { describe, expect, it } from "vitest";
import { RollingPricingWindow } from "../src/modules/pricing/rolling-pricing-window.js";

const base = Date.parse("2026-10-13T12:00:00.000Z");
const tick = (seconds: number, buy: number, sell = buy + 0.01) => ({
  symbol: "EURUSD",
  buy,
  sell,
  timestamp: new Date(base + seconds * 1000),
});

describe("RollingPricingWindow", () => {
  it("calculates high, low and percentage change from the active 24-hour window", () => {
    const window = new RollingPricingWindow("EURUSD");
    window.add(tick(-3600, 100), base);
    window.add(tick(-1800, 120), base);
    const snapshot = window.add(tick(0, 110), base);

    expect(snapshot).toMatchObject({
      buy: 110,
      high24h: 120,
      low24h: 100,
      change24h: 10,
    });
  });

  it("expires old extrema and uses the earliest remaining tick as the baseline", () => {
    const window = new RollingPricingWindow("EURUSD");
    window.add(tick(-90_000, 50), base);
    window.add(tick(-80_000, 100), base);
    window.add(tick(-70_000, 80), base);
    const snapshot = window.add(tick(0, 120), base);

    expect(snapshot).toMatchObject({
      buy: 120,
      high24h: 120,
      low24h: 80,
      change24h: 20,
    });
  });

  it("inserts out-of-order ticks by timestamp and recalculates the baseline and extrema", () => {
    const window = new RollingPricingWindow("EURUSD");
    window.add(tick(-100, 100), base);
    window.add(tick(0, 120), base);
    const snapshot = window.add(tick(-50, 80), base);

    expect(snapshot).toMatchObject({
      buy: 120,
      high24h: 120,
      low24h: 80,
      change24h: 20,
    });
  });

  it("retains same-timestamp ticks deterministically and uses the last arrival as latest", () => {
    const window = new RollingPricingWindow("EURUSD");
    window.add(tick(0, 100), base);
    const snapshot = window.add(tick(0, 105), base);

    expect(snapshot).toMatchObject({
      buy: 105,
      high24h: 105,
      low24h: 100,
      change24h: 5,
    });
  });

  it("rebuilds the same result when historical ticks are replayed in event-time order", () => {
    const historical = [tick(-300, 100), tick(-200, 90), tick(-100, 110)];
    const recovered = new RollingPricingWindow("EURUSD");
    for (const row of historical) recovered.add(row, base);

    expect(recovered.snapshot(base)).toMatchObject({
      buy: 110,
      high24h: 110,
      low24h: 90,
      change24h: 10,
    });
  });
});

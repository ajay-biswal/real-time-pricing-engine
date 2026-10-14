import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, redisSet, redisPublish } = vi.hoisted(() => ({
  findMany: vi.fn(),
  redisSet: vi.fn(),
  redisPublish: vi.fn(),
}));

vi.mock("../src/config/prisma.js", () => ({
  prisma: {
    marketTick: {
      findMany,
    },
  },
}));

vi.mock("../src/config/redis.js", () => ({
  redisClient: {
    set: redisSet,
    publish: redisPublish,
  },
}));

describe("pricing state recovery", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    findMany.mockResolvedValue([
      {
        symbol: "EURUSD",
        buy: 1.1,
        sell: 1.2,
        timestamp: new Date(Date.now() - 2_000),
      },
      {
        symbol: "EURUSD",
        buy: 1.2,
        sell: 1.3,
        timestamp: new Date(Date.now() - 1_000),
      },
    ]);
    redisSet.mockResolvedValue("OK");
    redisPublish.mockResolvedValue(1);
  });

  it("loads persisted ticks in event-time order and republishes a recovered snapshot", async () => {
    const { initializePricingState } = await import("../src/modules/pricing/pricing-state.js");
    await initializePricingState();

    expect(findMany).toHaveBeenCalledOnce();
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ symbol: "asc" }, { timestamp: "asc" }, { id: "asc" }],
    }));
    expect(redisSet).toHaveBeenCalledOnce();
    expect(redisSet).toHaveBeenCalledWith("market:snapshot:EURUSD", expect.any(String));

    const snapshot = JSON.parse(redisSet.mock.calls[0]![1] as string) as {
      buy: string;
      sell: string;
      high24h: string;
      low24h: string;
      change24h: string;
    };
    expect(snapshot).toMatchObject({
      buy: "1.2",
      sell: "1.3",
      high24h: "1.2",
      low24h: "1.1",
    });
    expect(Number(snapshot.change24h)).toBeCloseTo(9.090909, 5);
    expect(redisPublish).toHaveBeenCalledOnce();
  });
});

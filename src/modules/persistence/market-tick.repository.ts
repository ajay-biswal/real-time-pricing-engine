import { prisma } from "../../config/prisma.js";

export interface MarketTickInput {
  symbol: string;
  buy: number;
  sell: number;
  timestamp: Date;
}

export async function saveMarketTick(
  tick: MarketTickInput,
): Promise<void> {
  await prisma.marketTick.create({
    data: {
      symbol: tick.symbol,
      buy: tick.buy,
      sell: tick.sell,
      timestamp: tick.timestamp,
    },
  });
}
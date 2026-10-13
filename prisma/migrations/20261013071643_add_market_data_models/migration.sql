-- CreateTable
CREATE TABLE "MarketTick" (
    "id" BIGSERIAL NOT NULL,
    "symbol" VARCHAR(20) NOT NULL,
    "buy" DECIMAL(20,10) NOT NULL,
    "sell" DECIMAL(20,10) NOT NULL,
    "timestamp" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MarketTick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSnapshot" (
    "symbol" VARCHAR(20) NOT NULL,
    "buy" DECIMAL(20,10) NOT NULL,
    "sell" DECIMAL(20,10) NOT NULL,
    "high24h" DECIMAL(20,10) NOT NULL,
    "low24h" DECIMAL(20,10) NOT NULL,
    "change24h" DECIMAL(12,6) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("symbol")
);

-- CreateIndex
CREATE INDEX "MarketTick_symbol_timestamp_idx" ON "MarketTick"("symbol", "timestamp");

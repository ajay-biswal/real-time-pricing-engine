-- Collapse duplicates already present before adding the idempotency constraint.
WITH ranked_ticks AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "symbol", "timestamp", "buy", "sell"
      ORDER BY "id"
    ) AS duplicate_rank
  FROM "MarketTick"
)
DELETE FROM "MarketTick" AS tick
USING ranked_ticks AS ranked
WHERE tick."id" = ranked."id"
  AND ranked.duplicate_rank > 1;

CREATE UNIQUE INDEX "MarketTick_symbol_timestamp_buy_sell_key"
ON "MarketTick" ("symbol", "timestamp", "buy", "sell");

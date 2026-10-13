# Real-Time Pricing Engine

Low-latency market-data ingestion and WebSocket distribution built with Node.js, TypeScript, Express, PostgreSQL/Prisma, Redis, and `ws`.

## Architecture

1. **Provider ingestion** connects to the configured market-data WebSocket, authenticates, and subscribes to 61 symbols.
2. **Pricing state** updates an in-memory rolling 24-hour window per symbol. High/low and percentage change are calculated from received ticks rather than copied from provider summary fields.
3. **Persistence** batches ticks into PostgreSQL using Prisma. Startup restores ticks from the preceding 24 hours before ingestion starts.
4. **Distribution** publishes snapshots to Redis Pub/Sub and stores the latest snapshot in Redis. Client WebSocket connections subscribe to selected symbols and receive cached snapshots plus live updates.
5. **Metrics** report queue wait, database batch write, batch size, flush reasons, and ingestion latency.

## Requirements

- Node.js 22+
- pnpm 10+
- PostgreSQL
- Redis
- Provider WebSocket URL and API credentials for live mode

## Configuration

Copy the example file and set credentials:

```sh
cp .env.example .env
```

| Variable | Purpose |
| --- | --- |
| `MARKET_DATA_MODE` | `live` (default) or `mock` synthetic test feed |
| `MARKET_WS_URL` | Upstream market-data WebSocket URL |
| `MARKET_API_KEY` | Provider API key (live mode) |
| `MARKET_SECRET_KEY` | Provider secret (live mode) |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `PORT` | HTTP/WebSocket server port |

Never commit `.env` or real credentials. Mock mode emits synthetic prices for all 61 symbols once per second. It is intended only to validate ingestion, persistence, rolling calculations, Redis publishing, client subscriptions, and frame/latency measurement. It is **not real market data** and must not be used for trading or represented as a live-provider benchmark.

## Run locally

```sh
pnpm install
pnpm exec prisma generate
pnpm exec prisma migrate deploy
pnpm dev
```

The HTTP health endpoint is `GET /health`. The client WebSocket endpoint is `ws://localhost:<PORT>/ws`.

## Client WebSocket protocol

Connect to `/ws`, then send a JSON subscription message:

```json
{ "action": "subscribe", "symbols": ["EURUSD", "GBPUSD"] }
```

To unsubscribe:

```json
{ "action": "unsubscribe", "symbols": ["EURUSD"] }
```

Events include `subscribed` / `unsubscribed` acknowledgements, `marketPriceSnapshot` for cached state, `marketPriceUpdate` for live updates, and `error` for invalid requests. Each pricing payload contains `symbol`, `buy`, `sell`, `high24h`, `low24h`, `change24h`, `updatedAt`, and `publishedAt`. Numeric prices are serialized as strings to preserve JSON decimal representation. A client can subscribe to up to 100 symbols.

## Docker Compose

Ensure `.env` exists. Start the stack:

```sh
docker compose up --build -d
docker compose ps
curl -i http://localhost:5000/health
```

Compose starts PostgreSQL and Redis with health checks and applies migrations before the application starts. PostgreSQL is exposed on host port 5433 and Redis on 6379; the API connects to the internal service names and ports. The local Compose database password is `postgres` and must be changed before any non-local deployment.

To test the whole pipeline when the upstream provider is unavailable, set `MARKET_DATA_MODE=mock` in `.env`, then recreate the app:

```sh
docker compose up -d --build --force-recreate app
docker compose logs -f app
```

To use the real feed, set `MARKET_DATA_MODE=live` and provide valid provider credentials.

## Tests and benchmark

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm benchmark:ws -- ALL 120
```

Start the server before running the WebSocket benchmark. It subscribes to all 61 configured symbols and measures actual individual UTF-8 frame sizes, publication-to-client distribution latency, and update/snapshot counts. A result from mock mode validates the local distribution pipeline only; it does not establish real-provider availability or true provider-event-to-client latency. Treat the 50 ms distribution target as met only when the benchmark has sufficient live update samples and p95 publication-to-client latency is at most 50 ms.

## Known upstream dependency

The configured live provider previously returned `already have an active session` and later closed with WebSocket code `1006`. The cause has not been confirmed. Use the provider's documented session lifecycle; do not assume an undocumented logout message. Until real ticks are received, live-ingestion and end-to-end latency acceptance checks remain unverified.

# Real-Time Pricing Engine

Low-latency market-data ingestion and WebSocket distribution built with Node.js, TypeScript, Express, PostgreSQL/Prisma, Redis, and `ws`.

## Architecture

1. **Provider ingestion** connects to the configured market-data WebSocket, authenticates, and subscribes to the configured 61-symbol list.
2. **Pricing state** updates an in-memory rolling 24-hour window per symbol. High/low and percentage change are calculated from received ticks rather than copied from provider summary fields.
3. **Persistence** batches ticks into PostgreSQL using Prisma. Startup restores ticks from the preceding 24 hours before provider ingestion starts.
4. **Distribution** publishes current snapshots to Redis Pub/Sub and stores the latest snapshot in Redis. Client WebSocket connections subscribe to selected symbols and receive cached snapshots plus live updates.
5. **Metrics** periodically report queue wait, database batch write, batch size, flush reasons, and ingestion latency.

## Requirements

- Node.js 22+
- pnpm 10+
- PostgreSQL
- Redis
- Provider WebSocket URL and API credentials

## Configuration

Copy the example file and set the provider credentials:

```sh
cp .env.example .env
```

Required environment variables:

| Variable | Purpose |
| --- | --- |
| `MARKET_WS_URL` | Upstream market-data WebSocket URL |
| `MARKET_API_KEY` | Provider API key |
| `MARKET_SECRET_KEY` | Provider secret |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `PORT` | HTTP/WebSocket server port |

Do not commit `.env` or real credentials.

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

Events include:

- `subscribed` / `unsubscribed` — subscription acknowledgement
- `marketPriceSnapshot` — cached current snapshot after subscription
- `marketPriceUpdate` — live snapshot update
- `error` — malformed request or subscription limit exceeded

Each pricing payload contains `symbol`, `buy`, `sell`, `high24h`, `low24h`, `change24h`, and `updatedAt`. Numeric prices are serialized as strings to preserve decimal precision. A client can subscribe to up to 100 symbols.

## Docker Compose

Ensure `.env` exists and contains the provider credentials, then run:

```sh
docker compose up --build
```

Compose starts PostgreSQL and Redis with health checks, runs Prisma migrations before the application starts, and exposes the app on port 5000. PostgreSQL is exposed on host port 5433 to avoid a host-side 5432 conflict. The container connects to the Compose services using internal hostnames.

The Compose database password defaults to `postgres` for local assessment use only. Change it for any non-local deployment and keep credentials out of version control.

## Tests and benchmark

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm benchmark:ws -- ALL 120
```

Start the server before running the WebSocket benchmark. The benchmark subscribes to all 61 configured symbols and reports actual individual frame sizes, publication-to-client distribution latency, and update/snapshot counts. The distribution latency measurement is not the same as provider-event-to-client latency. If the upstream provider is disconnected or returning stale snapshots, a benchmark cannot prove the live 50 ms requirement.

## Known operational dependency

The upstream provider may reject authentication with `already have an active session` (close code `4003`). That response must be resolved using the provider's documented session lifecycle; do not assume an undocumented logout message. Until live updates are received, live-ingestion and end-to-end latency acceptance checks remain incomplete.

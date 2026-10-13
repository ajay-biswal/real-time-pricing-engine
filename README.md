# Real-Time Pricing Engine

A low-latency, fault-tolerant market-data processing system that ingests prices over WebSockets, calculates rolling 24-hour statistics, persists state, and distributes updates to subscribed clients.

## 1. Assignment objectives

- Connect to the supplied market-data WebSocket and authenticate using the provided credentials.
- Subscribe to all 61 required symbols.
- Calculate buy/sell prices and independently compute rolling 24-hour high, low, and percentage change. Do not rely on the provider's `low_24h`, `high_24h`, or `change_24h` fields.
- Persist and restore state across restarts.
- Provide a separate WebSocket server for multiple clients and symbol subscriptions.
- Keep outbound messages below 10 KB.
- Target end-to-end latency of no more than 50 ms or one market-data tick.
- Handle disconnects, duplicates, out-of-order data, and traffic spikes.
- Provide a Dockerized setup.

## 2. Technology stack

| Component | Technology |
| --- | --- |
| Runtime and language | Node.js 22, TypeScript |
| HTTP server | Express |
| WebSocket | `ws` |
| Database | PostgreSQL |
| Database toolkit | Prisma |
| Cache and distribution | Redis / Pub/Sub |
| Containers | Docker, Docker Compose |
| Package manager | pnpm |
| Tests | Jest |
| CI | GitHub Actions |

## 3. Architecture diagram

The application separates upstream ingestion, pricing calculations, persistence, and downstream distribution.

~~~mermaid
flowchart TD
    A["Market Data Provider"]
    B["Upstream WebSocket Client"]
    C["Authenticate and Subscribe"]
    D["Validate Incoming Tick"]
    E["Pricing State and Rolling 24h Window"]
    F["PostgreSQL: Tick History and Snapshots"]
    G["Redis: Latest State and Pub/Sub"]
    H["Client WebSocket Server (/ws)"]
    I["Client A"]
    J["Client B"]
    K["Client N"]

    A --> B --> C --> D --> E
    E --> F
    E --> G --> H
    H --> I
    H --> J
    H --> K
~~~

### Component responsibilities

1. **Market-data ingestion:** Connects to the configured upstream WebSocket, authenticates, and subscribes to the required symbols.
2. **Pricing engine:** Updates per-symbol pricing state and calculates the engine's own 24-hour statistics from ticks.
3. **Rolling window:** Maintains time-ordered observations and uses monotonic queues/deques for efficient high/low tracking.
4. **PostgreSQL:** Persists market ticks and snapshots for recovery.
5. **Redis:** Caches the latest state and distributes updates using Pub/Sub.
6. **Client WebSocket server:** Serves `/ws`, handles symbol subscriptions, sends cached snapshots, and distributes updates.
7. **Recovery:** Restores recent ticks from PostgreSQL and reconstructs pricing state during startup.

## 4. Data flow

1. Connect to the upstream provider.
2. Authenticate with the assigned credentials.
3. Subscribe to the 61 symbols listed in the assignment.
4. Receive and validate incoming ticks.
5. Update in-memory pricing state and rolling 24-hour statistics.
6. Persist ticks in batches and update snapshots.
7. Publish current pricing state through Redis.
8. Send snapshots and subsequent updates to subscribed clients.
9. Measure frame size and latency.

**Live-feed status:** The upstream connection has returned `already have an active session` and subsequently closed. The complete live data flow is therefore not yet verified.

## 5. Pricing calculations

The engine must calculate its own rolling 24-hour high, low, and percentage change rather than trusting the provider's calculated summary fields.

For each symbol, the output includes:

- Current buy price and sell price.
- Highest eligible price in the rolling 24-hour window.
- Lowest eligible price in the rolling 24-hour window.
- Percentage change using the implementation's defined reference price.

A conventional percentage-change formula is:

~~~text
percentage_change = ((current_price - reference_price) / reference_price) * 100
~~~

The reference-price definition must be consistent. Handle a missing reference price and division by zero explicitly. Expire observations outside the rolling 24-hour window so high/low values do not become lifetime extrema.

The rolling pricing component uses time-ordered history and monotonic data structures to avoid rescanning every retained tick to calculate extrema.

## 6. State management and persistence

PostgreSQL is used for durable history and snapshots. Redis is used for cached state and real-time distribution.

The intended startup recovery sequence is:

1. Initialize PostgreSQL connectivity.
2. Load retained tick history for the rolling window.
3. Reconstruct in-memory pricing state.
4. Repopulate relevant Redis state.
5. Resume normal processing when new market data is available.

Database writes are batched to reduce per-tick overhead. Batching trades some persistence delay for fewer database operations. Recovery correctness should be tested by persisting actual ticks, restarting the service, and comparing restored statistics with expected values.

## 7. Client WebSocket protocol

Local endpoint:

~~~text
ws://localhost:5000/ws
~~~

Use a secure `wss://` endpoint when deployed behind correctly configured TLS.

Connect and subscribe using the implemented JSON protocol:

~~~json
{ "action": "subscribe", "symbols": ["EURUSD", "GBPUSD"] }
~~~

Unsubscribe from symbols:

~~~json
{ "action": "unsubscribe", "symbols": ["EURUSD"] }
~~~

The server emits subscription acknowledgements, cached pricing snapshots, live pricing updates, and errors for invalid requests. Pricing payloads include symbol, buy/sell, high/low, percentage change, and timestamps. Numeric prices are serialized as strings to preserve decimal representation. A client can subscribe to up to 100 symbols.

Multiple clients can maintain independent symbol subscriptions. Redis Pub/Sub decouples pricing publication from client delivery; however, Pub/Sub is not durable, so disconnected consumers may need a fresh snapshot after reconnecting.

## 8. Payload optimization

The assignment requires every outbound payload to be smaller than 10 KB. The benchmark measures the actual serialized UTF-8 WebSocket frame size, not the size of an in-memory object.

Validation should cover:

- Individual frame sizes.
- Subscriptions containing different numbers of symbols.
- Maximum frame size under realistic client usage.
- Delivery of only the data required by each subscription.

A previous limited observation recorded a 251-byte maximum frame. Reproduce this measurement under final test conditions before treating it as a final benchmark result.

## 9. Latency and performance

The assignment target is end-to-end latency of no more than 50 ms or one market-data tick.

### Design choices supporting low latency

- In-memory pricing state.
- Monotonic queues/deques for efficient extrema tracking.
- Batched PostgreSQL writes.
- Redis-based publication and client distribution.
- Separation of ingestion from downstream delivery.
- Per-client symbol subscriptions.

### Metrics to report

| Metric | How to measure |
| --- | --- |
| Inbound tick rate | Accepted ticks per second |
| Processing latency | Tick receipt to pricing-state update |
| Distribution latency | Publication timestamp to client delivery |
| End-to-end latency | Provider event to client receipt, where timestamps permit |
| Frame size | Actual serialized WebSocket frame size |
| Symbol coverage | Symbols receiving valid updates |
| Persistence throughput | Ticks written per second |
| Recovery time | Time required to restore state after restart |

Use consistent timestamps and distinguish distribution latency from true provider-event-to-client latency. Account for clock differences when using provider timestamps.

### Results and verification status

| Metric | Current status |
| --- | --- |
| Live-feed latency | Not verified |
| P95 end-to-end latency | Not verified |
| Maximum end-to-end latency | Not verified |
| 50 ms target | Not yet demonstrated |
| Maximum frame size | Previous limited observation: 251 bytes; revalidation required |
| Live updates for all 61 symbols | Not verified |

Build and unit-test success do not prove live latency compliance. Do not claim the 50 ms target is met until sufficient real-feed samples have been collected under representative load.

## 10. Fault tolerance

The assignment requires handling disconnects, duplicate messages, out-of-order data, and spikes. Persistence, cached state, batching, and separation of components support recovery, but individual failure modes must be tested.

Required validation includes:

- Upstream reconnect and resubscription.
- Duplicate-tick detection or idempotent processing.
- Out-of-order timestamp handling.
- Stale or invalid data handling.
- PostgreSQL and Redis failure behavior.
- Queue limits and overload behavior.
- State restoration after restart.
- Client disconnect and reconnect behavior.

Only mark a behavior as supported after confirming it in code and tests.

## 11. Design decisions and trade-offs

### PostgreSQL persistence

PostgreSQL provides durable market history and snapshots. Batching reduces write overhead but may increase persistence delay and the amount of unflushed data at risk during a failure.

### Redis Pub/Sub

Redis decouples pricing publication from client delivery. Pub/Sub does not retain messages for disconnected consumers, so clients may need to request or receive a fresh snapshot after reconnecting.

### In-memory rolling window

In-memory state supports fast calculations. It must be reconstructed after a process restart, making recovery dependent on retained history and correct replay logic.

### Separate ingestion and distribution

This prevents every downstream client from needing its own provider connection. The extra publication and delivery path adds complexity and latency that must be measured.

### JSON payloads

JSON is readable and widely supported, but generally less compact than a purpose-built binary protocol. Actual frame sizes must be measured against the 10 KB limit.

## 12. Challenges faced

### Upstream WebSocket session error

**Problem:** The provider endpoint `wss://v3-prod.livefxhub.com/ws/algo` returned `already have an active session` and the connection subsequently closed.

**Investigation:** Application configuration and credentials were checked, and the application was restarted. The issue persisted.

**Status:** The root cause has not been confirmed. The person who provided the API access has been asked to help clarify the session behavior and authentication expectations.

**Impact:** Live ingestion, confirmation of all 61 live symbols, and live end-to-end performance testing are blocked.

**Next step:** Confirm the provider's session policy and expected authentication sequence, resolve the connection issue, then verify authentication, subscription acknowledgements, and actual price updates.

### Latency target

**Problem:** The system must distribute updates within 50 ms or one tick.

**Approach:** In-memory pricing state, efficient extrema tracking, batched persistence, and Redis distribution reduce avoidable processing overhead.

**Status:** Live latency compliance is unverified while the upstream feed is blocked. Measure processing, distribution, and end-to-end latency separately after real updates are flowing.

### State recovery

**Problem:** Rolling statistics must remain correct across restarts.

**Approach:** Persist tick history and snapshots, restore recent observations, and reconstruct relevant Redis state.

**Validation needed:** Restart after real ticks have been persisted and compare restored statistics against expected values.

### Payload size

**Problem:** Outbound messages must remain under 10 KB.

**Approach:** Measure actual serialized frame size and test different symbol subscriptions.

**Validation needed:** Recheck maximum frame size under final test conditions.

### Irregular market data

**Problem:** Duplicate, out-of-order, stale, or bursty ticks can affect correctness and latency.

**Validation needed:** Run targeted tests for duplicates, timestamp ordering, disconnections, and supporting-service failures. Document the results rather than assuming these cases are fully handled.

## 13. Setup and installation

### Prerequisites

- Docker and Docker Compose.
- Git.
- For local development: Node.js 22 and pnpm 10.

### Clone the repository

~~~bash
git clone https://github.com/ajay-biswal/real-time-pricing-engine.git
cd real-time-pricing-engine
~~~

### Configure environment variables

~~~bash
cp .env.example .env
~~~

Configure the database URL, Redis URL, upstream WebSocket URL, and provider credentials using the variable names in `.env.example`. Never commit `.env` or real credentials.

### Run with Docker Compose

~~~bash
docker compose up --build -d
docker compose ps
docker compose logs -f app
~~~

Check the health endpoint:

~~~bash
curl -i http://localhost:5000/health
~~~

A healthy HTTP endpoint confirms that the HTTP server is responding; it does not prove that the provider is sending live prices.

The Compose configuration exposes PostgreSQL on host port 5433 and Redis on host port 6379. Verify these ports against the current Compose file. Change development credentials before any non-local deployment.

### Local development commands

~~~bash
pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm exec prisma migrate deploy
pnpm dev
~~~

Available validation commands:

~~~bash
pnpm typecheck
pnpm test
pnpm build
~~~

The exact scripts are defined in `package.json`.

## 14. Benchmarking

Start the application, then run:

~~~bash
pnpm benchmark:ws -- ALL 120
~~~

The benchmark subscribes to all 61 configured symbols and measures individual frame sizes, publication-to-client distribution latency, and update/snapshot counts.

Interpret results according to the data source and test conditions. A successful health check is not proof of market-data ingestion. A benchmark without sufficient real updates cannot demonstrate live-feed latency compliance.

## 15. Continuous integration

The latest recorded GitHub Actions run passed dependency installation, TypeScript type checking, automated tests, and the production build.

These checks apply to the tested commit. They do not verify that the external provider is available, that all 61 symbols are updating live, or that the 50 ms end-to-end target is met.

## 16. Known limitations

1. The live provider connection is blocked by the reported active-session error.
2. Live end-to-end latency and compliance with the 50 ms target have not been verified.
3. Live coverage of all 61 symbols has not been confirmed.
4. Fault-tolerance behavior must be validated against the required failure scenarios.
5. Performance depends on environment, traffic, client count, and provider behavior.

## 17. Repository structure

The main components are organized by responsibility. Refer to the repository for the exact current layout.

~~~text
src/
  config/
  modules/
    market-data/
    pricing/
    persistence/
    distribution/
  main.ts
prisma/
scripts/
.github/
Dockerfile
docker-compose.yml
.env.example
README.md
~~~

## 18. Assignment deliverables

- [x] GitHub repository and source code.
- [x] Core pricing and distribution components implemented.
- [x] Automated CI checks.
- [x] Architecture and design documentation included in this README.
- [x] Current challenges and limitations documented.
- [ ] Live authentication and market-data updates verified.
- [ ] Live latency and all-symbol coverage verified.
- [ ] Final frame-size results reproduced.
- [ ] Fault-tolerance and restart-recovery scenarios validated.
- [ ] Architecture and setup instructions checked against the final repository state.

## 19. Conclusion

The project implements the main components of a real-time pricing engine: market-data ingestion, rolling pricing calculations, PostgreSQL persistence, Redis-based distribution, and a client-facing WebSocket server.

The critical remaining dependency is a successful connection to the assigned live market-data provider. Once the feed is restored, the complete pipeline must be validated with real ticks and measured against the assignment's latency, payload-size, symbol-coverage, persistence, and fault-tolerance requirements.

Implementation status is documented separately from verification status so that successful builds and tests are not mistaken for complete live-system validation.

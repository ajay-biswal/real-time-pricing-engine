import WebSocket from "ws";

const port = Number(process.env.PORT ?? 5000);
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const symbol = (args[0] ?? "EURUSD").toUpperCase();
const requestedDuration = Number(args[1] ?? 30);
const durationSeconds = Number.isFinite(requestedDuration)
  ? Math.max(5, requestedDuration)
  : 30;
const url = `ws://127.0.0.1:${port}/ws`;
const distributionSamples = [];
const tickAgeSamples = [];
let updates = 0;
let invalidTimestamps = 0;
let socket;

const timer = setTimeout(() => {
  socket?.close(1000, "Benchmark complete");
}, durationSeconds * 1000);

socket = new WebSocket(url);

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(Math.ceil(p * sorted.length) - 1, sorted.length - 1);
  return sorted[index] ?? 0;
}

socket.on("open", () => {
  console.log(`Connected to ${url}; subscribing to ${symbol} for ${durationSeconds}s`);
  socket.send(JSON.stringify({ action: "subscribe", symbols: [symbol] }));
});

socket.on("message", (raw) => {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    return;
  }

  if (message.event !== "marketPriceUpdate" || message.data?.symbol !== symbol) return;

  updates += 1;
  const publishedAt = Date.parse(message.data.publishedAt ?? "");
  if (!Number.isFinite(publishedAt)) {
    invalidTimestamps += 1;
    return;
  }

  const distributionLatencyMs = Date.now() - publishedAt;
  // Wall-clock measurement is suitable for this local same-host test; small
  // negative values indicate clock/timestamp resolution noise and are excluded.
  if (distributionLatencyMs >= 0) distributionSamples.push(distributionLatencyMs);
  else invalidTimestamps += 1;

  // updatedAt is the market tick timestamp stored in the snapshot. This measures
  // tick-to-client age only when the provider timestamp uses the same wall clock.
  const tickTimestamp = Date.parse(message.data.updatedAt ?? "");
  if (Number.isFinite(tickTimestamp)) {
    const tickAgeMs = Date.now() - tickTimestamp;
    if (tickAgeMs >= 0) tickAgeSamples.push(tickAgeMs);
  }
});

socket.on("error", (error) => {
  console.error("Benchmark WebSocket error:", error.message);
  clearTimeout(timer);
  process.exitCode = 1;
});

socket.on("close", () => {
  clearTimeout(timer);
  const distribution = [...distributionSamples].sort((a, b) => a - b);
  const tickAge = [...tickAgeSamples].sort((a, b) => a - b);
  const summarize = (sorted) => ({
    samples: sorted.length,
    p50: Number(percentile(sorted, 0.5).toFixed(2)),
    p95: Number(percentile(sorted, 0.95).toFixed(2)),
    p99: Number(percentile(sorted, 0.99).toFixed(2)),
    max: Number((sorted.at(-1) ?? 0).toFixed(2)),
  });
  const report = {
    symbol,
    durationSeconds,
    updatesReceived: updates,
    invalidTimestamps,
    distributionLatencyMs: summarize(distribution),
    tickToClientAgeMs: summarize(tickAge),
    distributionMeets50ms: distribution.length > 0 && percentile(distribution, 0.95) <= 50,
    tickToClientMeets50ms: tickAge.length > 0 && percentile(tickAge, 0.95) <= 50,
    note: "Distribution latency is publication-to-receipt. Tick-to-client age uses snapshot.updatedAt and is valid only if provider timestamps are synchronized to this host's wall clock.",
  };
  console.log(JSON.stringify(report, null, 2));
  if (distribution.length === 0) process.exitCode = 1;
});


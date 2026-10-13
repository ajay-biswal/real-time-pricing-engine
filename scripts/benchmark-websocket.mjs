import WebSocket from "ws";

const port = Number(process.env.PORT ?? 5000);
const symbol = (process.argv[2] ?? "EURUSD").toUpperCase();
const durationSeconds = Math.max(5, Number(process.argv[3] ?? 30));
const url = `ws://127.0.0.1:${port}/ws`;
const samples = [];
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

  const latencyMs = Date.now() - publishedAt;
  // Wall-clock measurement is suitable for this local same-host test; small
  // negative values indicate clock/timestamp resolution noise and are excluded.
  if (latencyMs >= 0) samples.push(latencyMs);
  else invalidTimestamps += 1;
});

socket.on("error", (error) => {
  console.error("Benchmark WebSocket error:", error.message);
  clearTimeout(timer);
  process.exitCode = 1;
});

socket.on("close", () => {
  clearTimeout(timer);
  const sorted = [...samples].sort((a, b) => a - b);
  const report = {
    symbol,
    durationSeconds,
    updatesReceived: updates,
    measuredSamples: sorted.length,
    invalidTimestamps,
    latencyMs: {
      p50: Number(percentile(sorted, 0.5).toFixed(2)),
      p95: Number(percentile(sorted, 0.95).toFixed(2)),
      p99: Number(percentile(sorted, 0.99).toFixed(2)),
      max: Number((sorted.at(-1) ?? 0).toFixed(2)),
    },
    meets50ms: sorted.length > 0 && percentile(sorted, 0.95) <= 50,
    note: "Publish-to-client latency using wall-clock timestamps on the same host; does not include provider-to-database delay.",
  };
  console.log(JSON.stringify(report, null, 2));
  if (sorted.length === 0) process.exitCode = 1;
});


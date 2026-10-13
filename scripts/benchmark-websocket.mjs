import WebSocket from "ws";

const port = Number(process.env.PORT ?? 5000);
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const requestedSymbol = (args[0] ?? "EURUSD").toUpperCase();
const requestedDuration = Number(args[1] ?? 30);
const durationSeconds = Number.isFinite(requestedDuration)
  ? Math.max(5, requestedDuration)
  : 30;
const symbols = requestedSymbol === "ALL"
  ? [
      "AUDUSD", "AUDCAD", "AUDCHF", "AUDJPY", "AUDNZD", "AUDSGD",
      "CADCHF", "CADJPY", "CHFJPY", "CHFSGD", "EURAUD", "EURCAD",
      "EURCHF", "EURGBP", "EURJPY", "EURNZD", "EURUSD", "GBPAUD",
      "GBPCAD", "GBPCHF", "GBPJPY", "GBPNZD", "GBPUSD", "NZDCAD",
      "NZDCHF", "NZDJPY", "NZDUSD", "USDCAD", "USDCHF", "USDCNH",
      "USDJPY", "USDMXN", "USDNOK", "USDPLN", "USDSEK", "USDSGD",
      "USDTRY", "USDZAR", "EURTRY", "GBPTRY", "NOKJPY", "SEKJPY",
      "SGDJPY", "ZARJPY", "XAUUSD", "XAGUSD", "BTCUSD", "ETHUSD",
      "BNBUSD", "SOLUSD", "XRPUSD", "ADAUSD", "DOGUSD", "DOTUSD",
      "LTCUSD", "BCHUSD", "XLMUSD", "TRXUSD", "UNIUSD", "FILUSD",
      "AVXUSD",
    ]
  : [requestedSymbol];
const url = `ws://127.0.0.1:${port}/ws`;
const distributionSamples = [];
const tickAgeSamples = [];
const frameBytes = [];
let updates = 0;
let snapshots = 0;
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
  console.log(`Connected to ${url}; subscribing to ${symbols.length} symbol(s) for ${durationSeconds}s`);
  socket.send(JSON.stringify({ action: "subscribe", symbols }));
});

socket.on("message", (raw) => {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    return;
  }

  if (!["marketPriceUpdate", "marketPriceSnapshot"].includes(message.event)) return;
  if (!symbols.includes(message.data?.symbol)) return;

  // Measure the exact UTF-8 JSON frame size received by this client.
  frameBytes.push(Buffer.byteLength(raw.toString(), "utf8"));
  if (message.event === "marketPriceSnapshot") snapshots += 1;
  if (message.event === "marketPriceUpdate") updates += 1;

  const publishedAt = Date.parse(message.data.publishedAt ?? "");
  if (Number.isFinite(publishedAt)) {
    const distributionLatencyMs = Date.now() - publishedAt;
    if (distributionLatencyMs >= 0) distributionSamples.push(distributionLatencyMs);
    else invalidTimestamps += 1;
  } else if (message.event === "marketPriceUpdate") {
    invalidTimestamps += 1;
  }

  // Provider payloads observed so far omit source timestamps, so updatedAt
  // may be application receipt time rather than provider event time.
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
  const sizes = [...frameBytes].sort((a, b) => a - b);
  const summarize = (sorted) => ({
    samples: sorted.length,
    p50: Number(percentile(sorted, 0.5).toFixed(2)),
    p95: Number(percentile(sorted, 0.95).toFixed(2)),
    p99: Number(percentile(sorted, 0.99).toFixed(2)),
    max: Number((sorted.at(-1) ?? 0).toFixed(2)),
  });
  const report = {
    symbolsSubscribed: symbols.length,
    durationSeconds,
    updatesReceived: updates,
    initialSnapshotsReceived: snapshots,
    invalidTimestamps,
    frameSizeBytes: {
      ...summarize(sizes),
      average: sizes.length
        ? Number((sizes.reduce((sum, size) => sum + size, 0) / sizes.length).toFixed(2))
        : 0,
      everyFrameUnder10KB: sizes.length > 0 && sizes.every((size) => size < 10 * 1024),
      totalBytesReceived: sizes.reduce((sum, size) => sum + size, 0),
    },
    distributionLatencyMs: summarize(distribution),
    tickToClientAgeMs: summarize(tickAge),
    distributionMeets50ms: distribution.length > 0 && percentile(distribution, 0.95) <= 50,
    note: "Frame sizes are measured on actual individual JSON frames, not as one combined 61-symbol snapshot. Distribution latency is publication-to-receipt. Tick age is not true provider-event latency unless updatedAt originates from the provider and shares the host clock.",
  };
  console.log(JSON.stringify(report, null, 2));
  if (distribution.length === 0) process.exitCode = 1;
});

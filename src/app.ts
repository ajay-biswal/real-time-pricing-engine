import express from "express";

export const app = express();

app.disable("x-powered-by");

app.use(express.json({ limit: "16kb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "real-time-pricing-engine",
    timestamp: new Date().toISOString(),
  });
});
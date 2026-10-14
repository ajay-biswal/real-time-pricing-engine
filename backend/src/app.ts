import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { authRouter } from "./modules/auth/auth.routes.js";
import { kycRouter } from "./modules/kyc/kyc.routes.js";
import { tradingRouter } from "./modules/trading/trading.routes.js";

export const app: Express = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "real-time-pricing-engine",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/auth", authRouter);
app.use("/api/kyc", kycRouter);
app.use("/api/trading", tradingRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled request error:", error);
  res.status(500).json({ error: "Internal server error" });
});

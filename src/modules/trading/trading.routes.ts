import { Router } from "express";
import { requireAuth, requireVerifiedMerchant } from "../auth/auth.middleware.js";

export const tradingRouter = Router();

tradingRouter.get("/access", requireAuth, requireVerifiedMerchant, (_req, res) => {
  res.status(200).json({
    access: "GRANTED",
    message: "Merchant is authenticated, active, and KYC-verified.",
  });
});

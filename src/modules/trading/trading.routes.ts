import { Router } from "express";
import { requireAuth, requireRole, requireVerifiedMerchant } from "../auth/auth.middleware.js";

export const tradingRouter: Router = Router();

tradingRouter.get("/access", requireAuth, requireRole("MERCHANT"), requireVerifiedMerchant, (_req, res) => {
  res.status(200).json({
    access: "GRANTED",
    message: "Merchant is authenticated, active, and KYC-verified.",
  });
});

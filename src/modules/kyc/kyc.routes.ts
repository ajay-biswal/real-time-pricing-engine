import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { reviewKyc, submitKyc } from "./kyc.controller.js";

export const kycRouter: Router = Router();

kycRouter.post("/submissions", requireAuth, requireRole("MERCHANT"), submitKyc);
kycRouter.patch("/admin/merchants/:merchantId/kyc", reviewKyc);

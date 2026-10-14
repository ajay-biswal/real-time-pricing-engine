import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { listPendingKyc, reviewKyc, submitKyc } from "./kyc.controller.js";

export const kycRouter: Router = Router();

kycRouter.post("/submissions", requireAuth, requireRole("MERCHANT"), submitKyc);
kycRouter.get("/admin/submissions", listPendingKyc);
kycRouter.patch("/admin/merchants/:merchantId/kyc", reviewKyc);

import { Router } from "express";
import { kycController } from "./kyc.controller.js";

export const kycRouter = Router();

kycRouter.use(kycController);

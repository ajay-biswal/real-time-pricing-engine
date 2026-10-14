import { Router } from "express";
import { requireAuth } from "./auth.middleware.js";
import {
  getCurrentMerchant,
  loginMerchant,
  logoutMerchant,
  registerMerchant,
} from "./auth.controller.js";
import { authRateLimit } from "./rate-limit.middleware.js";

export const authRouter: Router = Router();

authRouter.post("/register", authRateLimit, registerMerchant);
authRouter.post("/login", authRateLimit, loginMerchant);
authRouter.get("/me", requireAuth, getCurrentMerchant);
authRouter.post("/logout", requireAuth, logoutMerchant);

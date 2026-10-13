import { Router } from "express";
import { authController } from "./auth.controller.js";
import { authRateLimit } from "./rate-limit.middleware.js";

export const authRouter = Router();

authRouter.use(["/register", "/login"], authRateLimit);
authRouter.use(authController);

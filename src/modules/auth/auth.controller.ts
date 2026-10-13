import type { NextFunction, Request, Response } from "express";
import { authService, SESSION_TTL_SECONDS, AuthServiceError } from "./auth.service.js";
import { loginSchema, registerSchema } from "./auth.validation.js";
import { toPublicMerchant } from "./auth.types.js";

function sendError(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof AuthServiceError) {
    res.status(error.statusCode).json({
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
    return;
  }
  next(error);
}

export async function registerMerchant(req: Request, res: Response, next: NextFunction): Promise<void> {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid registration data", details: parsed.error.flatten() });
    return;
  }

  try {
    const merchant = await authService.register(parsed.data);
    res.status(201).json({
      message: "Merchant account created. Submit KYC before accessing trading functionality.",
      merchant: {
        id: merchant.id,
        email: merchant.email,
        role: merchant.role,
        accountStatus: merchant.accountStatus,
        kycStatus: merchant.kycStatus,
        createdAt: merchant.createdAt,
      },
    });
  } catch (error) {
    sendError(error, res, next);
  }
}

export async function loginMerchant(req: Request, res: Response, next: NextFunction): Promise<void> {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid login data", details: parsed.error.flatten() });
    return;
  }

  try {
    const { merchant, token } = await authService.login(parsed.data);
    res.status(200).json({
      message: "Login successful",
      accessToken: token,
      tokenType: "Bearer",
      expiresIn: SESSION_TTL_SECONDS,
      merchant: toPublicMerchant(merchant),
    });
  } catch (error) {
    sendError(error, res, next);
  }
}

export function getCurrentMerchant(req: Request, res: Response): void {
  if (!req.merchant) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  res.json({ merchant: toPublicMerchant(req.merchant) });
}

export async function logoutMerchant(req: Request, res: Response, next: NextFunction): Promise<void> {
  const match = req.header("authorization")?.match(/^Bearer\\s+(.+)$/i);
  if (!match?.[1]) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    await authService.logout(match[1]);
    res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    sendError(error, res, next);
  }
}

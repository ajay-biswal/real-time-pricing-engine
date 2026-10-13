import type { NextFunction, Request, Response } from "express";
import { redisClient } from "../../config/redis.js";

export function authRateLimit(req: Request, res: Response, next: NextFunction): void {
  void (async () => {
    const key = `auth:rate:${req.path}:${req.ip ?? "unknown"}`;
    const count = await redisClient.incr(key);
    if (count === 1) await redisClient.expire(key, 60);
    if (count > 20) {
      res.status(429).json({ error: "Too many authentication attempts; try again in a minute" });
      return;
    }
    next();
  })().catch(next);
}

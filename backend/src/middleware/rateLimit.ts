import rateLimit from "express-rate-limit";
import { config } from "../config";

// General API rate limit
export const apiRateLimit = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, slow down." },
});

// Tighter limit on auth endpoints to slow brute-force attempts
export const authRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  max: config.nodeEnv === "production" ? 10 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts, try again later." },
});

// Location ingestion gets its own generous-but-bounded limit: a worker sending
// updates every 60s plus occasional distance-triggered pings should never come
// close to this, but it caps abuse/misbehaving clients.
export const locationRateLimit = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? "unknown",
  message: { error: "Location update rate exceeded." },
});

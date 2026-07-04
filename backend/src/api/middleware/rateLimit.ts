import rateLimit from "express-rate-limit";
import { config } from "../../config.js";

export const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.rateLimit.public,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "TooManyRequests", message: "Rate limit exceeded" },
});

export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.rateLimit.auth,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "TooManyRequests", message: "Rate limit exceeded" },
});

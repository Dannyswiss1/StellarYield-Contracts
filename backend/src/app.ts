import cors from "cors";
import express, { type Express } from "express";
import { config } from "./config.js";
import { healthRouter } from "./api/routes/health.js";
import { vaultsRouter } from "./api/routes/vaults.js";
import { usersRouter } from "./api/routes/users.js";
import { yieldsRouter } from "./api/routes/yields.js";
import { adminRouter } from "./api/routes/admin.js";
import { webhooksRouter } from "./api/routes/webhooks.js";
import { errorHandler } from "./api/middleware/errors.js";
import { publicLimiter, authLimiter } from "./api/middleware/rateLimit.js";

export function createApp(): Express {
  const app = express();

  app.use(express.json());

  const origins = config.allowedOrigins;
  if (origins.length > 0) {
    const origin = origins.length === 1 && origins[0] === "*" ? "*" : origins;
    app.use(cors({ 
      origin,
      maxAge: config.cors.maxAge,
    }));
  }

  app.use("/health", publicLimiter, healthRouter);
  app.use("/api/v1/vaults", publicLimiter, vaultsRouter);
  app.use("/api/v1/users", publicLimiter, usersRouter);
  app.use("/api/v1/yields", publicLimiter, yieldsRouter);
  app.use("/api/v1/admin", authLimiter, adminRouter);
  app.use("/api/v1/webhooks", authLimiter, webhooksRouter);

  app.use(errorHandler);

  return app;
}

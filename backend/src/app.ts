import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { healthRouter } from "./api/routes/health.js";
import { vaultsRouter } from "./api/routes/vaults.js";
import { usersRouter } from "./api/routes/users.js";
import { yieldsRouter } from "./api/routes/yields.js";
import { adminRouter } from "./api/routes/admin.js";
import { webhooksRouter } from "./api/routes/webhooks.js";
import { errorHandler } from "./api/middleware/errors.js";
import { requestId } from "./api/middleware/requestId.js";
import { publicLimiter, authLimiter } from "./api/middleware/rateLimit.js";
import { httpRequestsTotal, getMetrics } from "./services/metrics.js";
import { setupOpenApiRoutes } from "./services/openapi.js";

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(pinoHttp({ logger }));
  app.use(express.json());

  const origins = config.allowedOrigins;
  if (origins.length > 0) {
    const origin = origins.length === 1 && origins[0] === "*" ? "*" : origins;
    app.use(cors({ origin }));
  }

  app.use(requestId);

  app.use((req, res, next) => {
    res.on("finish", () => {
      const route = req.route?.path ?? req.path;
      httpRequestsTotal.inc({ method: req.method, route, status: res.statusCode });
    });
    next();
  });

  app.use("/health", publicLimiter, healthRouter);
  app.use("/api/v1/vaults", publicLimiter, vaultsRouter);
  app.use("/api/v1/users", publicLimiter, usersRouter);
  app.use("/api/v1/yields", publicLimiter, yieldsRouter);
  app.use("/api/v1/admin", authLimiter, adminRouter);
  app.use("/api/v1/webhooks", authLimiter, webhooksRouter);
  app.get("/metrics", async (_req, res) => {
    res.set("Content-Type", "text/plain");
    res.send(await getMetrics());
  });

  setupOpenApiRoutes(app);

  app.use(errorHandler);

  return app;
}

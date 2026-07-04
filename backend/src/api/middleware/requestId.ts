import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../../logger.js";

declare module "express-serve-static-core" {
  interface Request {
    requestId: string;
    log: typeof logger;
  }
}

export function requestId(req: Request, res: Response, next: NextFunction) {
  const id = randomUUID();
  req.requestId = id;
  req.log = logger.child({ requestId: id });
  res.setHeader("X-Request-ID", id);
  next();
}

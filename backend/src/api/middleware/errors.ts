import type { ErrorRequestHandler } from "express";
import { logger } from "../../logger.js";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  (req.log ?? logger).error(err, "Unhandled error");
  res.status(err.statusCode ?? 500).json({
    error: err.name ?? "InternalServerError",
    message: err.message ?? "An unexpected error occurred",
  });
};

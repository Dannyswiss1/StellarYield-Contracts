import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";
import { z } from "zod";

// Stellar address validator: 56-character Strkey starting with 'G'
export const stellarAddressSchema = z
  .string()
  .length(56)
  .regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar address format");

export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res
        .status(400)
        .json({ error: "ValidationError", issues: result.error.issues });
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res
        .status(400)
        .json({ error: "ValidationError", issues: result.error.issues });
      return;
    }
    req.query = result.data;
    next();
  };
}

export function validateParams(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      res
        .status(400)
        .json({ error: "ValidationError", issues: result.error.issues });
      return;
    }
    req.params = result.data;
    next();
  };
}

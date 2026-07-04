import { Router } from "express";
import { z } from "zod";
import {
  getVaultEpochs,
  getUserPendingYield,
  getYieldSummary,
  getYieldPerShareHistory,
} from "../controllers/yields.js";
import { validateQuery } from "../middleware/validate.js";

const epochQuerySchema = z.object({
  epoch: z.coerce.number().int().positive().optional(),
});

const yieldHistoryQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).default(20).transform((v) => Math.min(v, 200)),
});

export const yieldsRouter = Router();

yieldsRouter.get("/:contractId/summary", getYieldSummary);
yieldsRouter.get("/:contractId/epochs", validateQuery(epochQuerySchema), getVaultEpochs);
yieldsRouter.get("/:contractId/yield-per-share-history", validateQuery(yieldHistoryQuerySchema), getYieldPerShareHistory);
yieldsRouter.get("/:contractId/pending/:userAddress", getUserPendingYield);

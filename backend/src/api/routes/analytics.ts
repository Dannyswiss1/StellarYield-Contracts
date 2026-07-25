import { Router } from "express";
import { getAnalyticsSummary } from "../controllers/analytics.js";

export const analyticsRouter = Router();

analyticsRouter.get("/summary", getAnalyticsSummary);

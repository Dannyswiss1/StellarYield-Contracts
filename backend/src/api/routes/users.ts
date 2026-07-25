import { Router } from "express";
import { z } from "zod";
import {
  getUser,
  getUserPortfolio,
  searchUsers,
  streamUserPositions,
} from "../controllers/users.js";
import {
  validateParams,
  validateQuery,
  stellarAddressSchema,
} from "../middleware/validate.js";

export const usersRouter = Router();

const addressParamSchema = z.object({
  address: stellarAddressSchema,
});

const searchQuerySchema = z.object({
  search: z.string().min(4, "Search query must be at least 4 characters long"),
});

usersRouter.get("/", validateQuery(searchQuerySchema), searchUsers);
usersRouter.get("/:address", validateParams(addressParamSchema), getUser);
usersRouter.get(
  "/:address/portfolio",
  validateParams(addressParamSchema),
  getUserPortfolio,
);
usersRouter.get(
  "/:address/stream",
  validateParams(addressParamSchema),
  streamUserPositions,
);

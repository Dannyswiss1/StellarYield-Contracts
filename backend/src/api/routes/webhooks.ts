import { Router } from "express";
import { z } from "zod";
import {
  createWebhook,
  listWebhooks,
  deleteWebhook,
  testWebhook,
  verifyWebhookSignature,
} from "../controllers/webhooks.js";
import { requireApiKey } from "../middleware/auth.js";
import { validateBody, validateParams } from "../middleware/validate.js";

const KNOWN_EVENTS = [
  "deposit",
  "withdraw",
  "yield_distributed",
  "vault_state_changed",
  "vault_created",
  "cancel_funding",
  "request_early_redemption",
  "user.deposit",
  "user.withdraw",
  "user.early_redemption_requested",
] as const;

const createWebhookSchema = z.object({
  url: z
    .string()
    .url()
    .refine((v) => v.startsWith("https://"), { message: "Webhook URL must use HTTPS" }),
  events: z
    .array(z.enum(KNOWN_EVENTS))
    .min(1, "At least one event must be specified"),
  secret: z.string().optional(),
});

const webhookParamsSchema = z.object({
  id: z.string().regex(/^\d+$/, "ID must be a positive integer"),
});

/** Schema for POST /webhooks/verify-signature (#664) */
const verifySignatureSchema = z.object({
  payload: z.string(),
  signature: z.string(),
  secret: z.string(),
});

export const webhooksRouter = Router();

webhooksRouter.use(requireApiKey());

webhooksRouter.post("/", validateBody(createWebhookSchema), createWebhook);
webhooksRouter.get("/", listWebhooks);
webhooksRouter.delete("/:id", validateParams(webhookParamsSchema), deleteWebhook);

/** POST /webhooks/verify-signature — verify HMAC signature (#664) */
webhooksRouter.post(
  "/verify-signature",
  validateBody(verifySignatureSchema),
  verifyWebhookSignature,
);

/** POST /admin/webhooks/:id/test — send test ping (#666) */
webhooksRouter.post("/:id/test", validateParams(webhookParamsSchema), testWebhook);

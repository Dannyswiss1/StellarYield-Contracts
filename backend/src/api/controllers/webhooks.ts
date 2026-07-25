import type { Request, Response, NextFunction } from "express";
import { query } from "../../db/index.js";
import { validateWebhookUrl, NotificationService } from "../../services/notifications.js";

const notificationService = new NotificationService();

interface WebhookRow {
  id: number;
  url: string;
  events: string[];
  active: boolean;
  created_at: Date;
  consecutive_failures: number;
}

function formatWebhook(w: WebhookRow) {
  return {
    id: w.id,
    url: w.url,
    events: w.events,
    active: w.active,
    createdAt: w.created_at,
    consecutiveFailures: w.consecutive_failures ?? 0,
  };
}

export async function createWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    const { url, events, secret } = req.body as { url: string; events: string[]; secret?: string };

    try {
      await validateWebhookUrl(url);
    } catch (err: any) {
      res.status(400).json({ error: "InvalidWebhookUrl", message: err.message });
      return;
    }

    const rows = await query<WebhookRow>(
      `INSERT INTO webhooks (url, events, secret)
       VALUES ($1, $2, $3)
       RETURNING id, url, events, active, created_at, consecutive_failures`,
      [url, events, secret ?? null],
    );

    res.status(201).json(formatWebhook(rows[0]));
  } catch (err) {
    next(err);
  }
}

export async function listWebhooks(_req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await query<WebhookRow>(
      "SELECT id, url, events, active, created_at, consecutive_failures FROM webhooks WHERE active = TRUE ORDER BY created_at DESC",
    );

    res.json(rows.map(formatWebhook));
  } catch (err) {
    next(err);
  }
}

export async function deleteWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    const id = parseInt(req.params["id"] as string, 10);

    const rows = await query<{ id: number }>(
      "UPDATE webhooks SET active = FALSE WHERE id = $1 AND active = TRUE RETURNING id",
      [id],
    );

    if (rows.length === 0) {
      res.status(404).json({ error: "NotFound", message: "Webhook not found" });
      return;
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/admin/webhooks/:id/test
 * Sends a test ping to the webhook URL and returns delivery metadata.
 * Issue #666.
 */
export async function testWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "InvalidId", message: "Webhook ID must be a positive integer" });
      return;
    }

    const rows = await query<WebhookRow>(
      "SELECT id, url, events, active, created_at, consecutive_failures, secret FROM webhooks WHERE id = $1",
      [id],
    );

    if (rows.length === 0) {
      res.status(404).json({ error: "NotFound", message: "Webhook not found" });
      return;
    }

    const webhook = rows[0] as WebhookRow & { secret: string | null };
    const result = await notificationService.testDeliver(webhook);

    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/webhooks/verify-signature
 * Verifies an HMAC-SHA256 webhook signature.
 * Issue #664.
 */
export async function verifyWebhookSignature(req: Request, res: Response, next: NextFunction) {
  try {
    const { payload, signature, secret } = req.body as {
      payload: string;
      signature: string;
      secret: string;
    };

    if (typeof payload !== "string" || typeof signature !== "string" || typeof secret !== "string") {
      res.status(400).json({ error: "BadRequest", message: "payload, signature, and secret are required strings" });
      return;
    }

    const valid = notificationService.verifySignature(payload, signature, secret);
    res.json({ valid });
  } catch (err) {
    next(err);
  }
}

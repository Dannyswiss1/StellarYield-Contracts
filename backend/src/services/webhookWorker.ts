import { createHmac } from "crypto";
import type { PgBoss } from "pg-boss";
import { query } from "../db/index.js";
import { logger } from "../logger.js";
import { sseService } from "./sse.js";
import { validateWebhookUrl } from "./notifications.js";

const MAX_CONSECUTIVE_FAILURES = 10;

interface WebhookRow {
  id: number;
  url: string;
  events: string[];
  secret: string | null;
  consecutive_failures: number;
}

export async function processWebhookDelivery(
  boss: PgBoss,
  webhookId: number,
  payload: string,
): Promise<void> {
  const webhookRows = await query<WebhookRow>(
    "SELECT id, url, events, secret, consecutive_failures FROM webhooks WHERE id = $1",
    [webhookId],
  );
  if (webhookRows.length === 0) return;
  const webhook = webhookRows[0];

  try {
    await validateWebhookUrl(webhook.url);
  } catch (err) {
    logger.warn(
      { webhookId: webhook.id, url: webhook.url, err },
      "Webhook URL failed SSRF check; skipping",
    );
    await recordFailure(webhook, payload, boss, "SSRF check failed");
    return;
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (webhook.secret) {
    const signature = createHmac("sha256", webhook.secret).update(payload).digest("hex");
    headers["X-StellarYield-Signature"] = `sha256=${signature}`;
  }

  const start = Date.now();
  try {
    const response = await fetch(webhook.url, {
      method: "POST",
      headers,
      body: payload,
      signal: AbortSignal.timeout(5000),
      redirect: "manual",
    });
    const durationMs = Date.now() - start;

    sseService.broadcastWebhookDelivery(webhook.id, {
      type: "delivery",
      attempt: 1,
      statusCode: response.status,
      durationMs,
      success: response.ok,
    });

    if (response.ok) {
      if ((webhook.consecutive_failures ?? 0) > 0) {
        await query("UPDATE webhooks SET consecutive_failures = 0 WHERE id = $1", [webhook.id]);
      }
      return;
    }

    await recordFailure(webhook, payload, boss, `non-2xx response: ${response.status}`);
  } catch (err) {
    const durationMs = Date.now() - start;
    sseService.broadcastWebhookDelivery(webhook.id, {
      type: "delivery",
      attempt: 1,
      statusCode: null,
      durationMs,
      success: false,
    });
    await recordFailure(webhook, payload, boss, String(err));
    throw err;
  }
}

async function recordFailure(
  webhook: WebhookRow,
  payload: string,
  boss: PgBoss,
  errorMessage: string,
): Promise<void> {
  const newFailures = (webhook.consecutive_failures ?? 0) + 1;

  if (newFailures >= MAX_CONSECUTIVE_FAILURES) {
    await query(
      "UPDATE webhooks SET consecutive_failures = $1, active = FALSE WHERE id = $2",
      [newFailures, webhook.id],
    );
    logger.warn(
      { webhookId: webhook.id, consecutiveFailures: newFailures },
      "Webhook auto-deactivated after reaching consecutive failure threshold",
    );
  } else {
    await query(
      "UPDATE webhooks SET consecutive_failures = $1 WHERE id = $2",
      [newFailures, webhook.id],
    );
  }

  await query(
    `INSERT INTO webhook_deliveries (webhook_id, payload, attempt, next_retry_at, last_error)
     VALUES ($1, $2, 1, NOW() + INTERVAL '5 seconds', $3)`,
    [webhook.id, payload, errorMessage],
  );

  sseService.broadcastWebhookDelivery(webhook.id, {
    type: "delivery",
    attempt: 1,
    statusCode: null,
    durationMs: 0,
    success: false,
  });
}

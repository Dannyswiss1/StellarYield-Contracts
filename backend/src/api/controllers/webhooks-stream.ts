import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { sseService } from "../../services/sse.js";
import { query } from "../../db/index.js";

const webhookParamsSchema = z.object({
  id: z.string().regex(/^\d+$/, "ID must be a positive integer"),
});

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0]!.trim();
  }
  return req.ip ?? "unknown";
}

export async function getWebhookStream(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const params = webhookParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "BadRequest", message: "Invalid webhook ID" });
      return;
    }

    const webhookId = parseInt(params.data.id, 10);

    const webhookRows = await query<{ id: number }>(
      "SELECT id FROM webhooks WHERE id = $1",
      [webhookId],
    );

    if (webhookRows.length === 0) {
      res.status(404).json({ error: "NotFound", message: "Webhook not found" });
      return;
    }

    const ip = getClientIp(req);
    const isAuthenticated = Boolean((req as any).apiKey);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const clientId = sseService.registerClient(res, ip, isAuthenticated);
    sseService.subscribeToWebhook(clientId, webhookId);

    res.write(":keep-alive\n\n");

    const keepAliveInterval = setInterval(() => {
      try {
        res.write(":keep-alive\n\n");
      } catch {
        cleanup();
      }
    }, 30000);

    const cleanup = () => {
      clearInterval(keepAliveInterval);
      sseService.unregisterClient(clientId);
      if (!res.headersSent) {
        res.end();
      }
    };

    req.on("close", cleanup);
    res.on("error", cleanup);
  } catch (err) {
    next(err);
  }
}

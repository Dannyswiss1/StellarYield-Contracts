import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { sseService } from "../../services/sse.js";

const streamQuerySchema = z.object({
  contractId: z.string().optional(),
});

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0]!.trim();
  }
  return req.ip ?? "unknown";
}

export async function getYieldsStream(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = streamQuerySchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "BadRequest", message: "Invalid query parameters" });
      return;
    }

    const contractId = query.data.contractId;
    const ip = getClientIp(req);
    const isAuthenticated = Boolean((req as any).apiKey);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const clientId = sseService.registerClient(res, ip, isAuthenticated);

    if (contractId) {
      sseService.subscribeToEpoch(clientId, contractId);
    }

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

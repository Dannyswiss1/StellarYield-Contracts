import { createHash } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { query } from "../../db/index.js";

interface ApiKey {
  id: number;
  role: string;
  label: string | null;
}

declare module "express-serve-static-core" {
  interface Request {
    apiKey?: ApiKey;
  }
}

export function requireApiKey(options?: { role?: string }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized", message: "Missing API key" });
      return;
    }

    const plaintext = authHeader.slice(7);
    const keyHash = createHash("sha256").update(plaintext).digest("hex");

    const rows = await query<ApiKey>(
      "SELECT id, role, label FROM api_keys WHERE key_hash = $1",
      [keyHash],
    ).catch(() => [] as ApiKey[]);

    if (rows.length === 0) {
      res.status(403).json({ error: "Forbidden", message: "Invalid API key" });
      return;
    }

    const apiKey = rows[0];
    if (options?.role && apiKey.role !== options.role) {
      res.status(403).json({ error: "Forbidden", message: "Insufficient permissions" });
      return;
    }

    req.apiKey = apiKey;
    next();
  };
}

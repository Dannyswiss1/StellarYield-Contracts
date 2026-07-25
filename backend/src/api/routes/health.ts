import { readFileSync } from "fs";
import { Router } from "express";
import { pool } from "../../db/index.js";

const { version } = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf-8"),
) as { version: string };

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  // Surface connection pool utilisation so operators can detect connection
  // exhaustion before it causes query timeouts (#657). `waiting > 0` means
  // requests are queued for a connection — a sign of pool pressure.
  const dbPool = {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };

  try {
    await pool.query("SELECT 1");
    res.json({ version, status: "ok", dbPool });
  } catch {
    res.status(503).json({ version, status: "error", dbPool });
  }
});

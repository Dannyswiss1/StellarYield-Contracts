import pg from "pg";
import { performance } from "node:perf_hooks";
import { config } from "../config.js";
import { logger } from "../logger.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.db.url,
  min: config.db.poolMin,
  max: config.db.poolMax,
  idleTimeoutMillis: config.db.idleTimeoutMs,
  query_timeout: config.db.queryTimeoutMs,
});

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const start = performance.now();
  const result = await pool.query(sql, params);
  const durationMs = performance.now() - start;
  const roundedMs = Math.round(durationMs * 100) / 100;

  if (durationMs > config.db.slowQueryMs) {
    // Slow queries get higher-visibility logging so they are easy to filter.
    // The full SQL is included regardless of environment to aid diagnosis (#658).
    logger.warn(
      { sql, paramsCount: params?.length ?? 0, durationMs: roundedMs, rowCount: result.rowCount },
      "slow query",
    );
  } else if (logger.level === "debug" || logger.level === "trace") {
    const firstLine = config.nodeEnv === "production"
      ? sql.slice(0, 80)
      : sql;
    logger.debug({ sql: firstLine, durationMs: roundedMs, rowCount: result.rowCount }, "query");
  }

  return result.rows;
}

async function validateConnection(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
    logger.info("Database connection established");
  } finally {
    client.release();
  }
}

process.on("SIGTERM", async () => {
  logger.info("Shutting down database pool");
  await pool.end();
});

// Validate on startup — exit immediately if DATABASE_URL is unreachable
if (process.env["NODE_ENV"] !== "test") {
  validateConnection().catch((err) => {
    logger.error(err, "Failed to connect to database");
    process.exit(1);
  });
}

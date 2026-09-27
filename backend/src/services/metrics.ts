import client from "prom-client";

const register = new client.Registry();

client.collectDefaultMetrics({ register });

export const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status"] as const,
  registers: [register],
});

// Error-rate companion to http_requests_total (#831). Kept as a separate
// counter so error ratios can be charted without a full label-set join in
// PromQL. `statusClass` collapses 400-499 into "4xx" and 500-599 into "5xx" to
// bound cardinality; everything else is ignored.
export const httpErrorsTotal = new client.Counter({
  name: "http_errors_total",
  help: "Total number of HTTP error responses (4xx and 5xx) by status class",
  labelNames: ["statusClass", "route"] as const,
  registers: [register],
});

export const indexerEventsProcessedTotal = new client.Counter({
  name: "indexer_events_processed_total",
  help: "Total number of on-chain events processed by the indexer",
  registers: [register],
});

export const indexerLastLedger = new client.Gauge({
  name: "indexer_last_ledger",
  help: "Last indexed ledger sequence number",
  registers: [register],
});

export const dbQueryDurationSeconds = new client.Histogram({
  name: "db_query_duration_seconds",
  help: "Database query duration in seconds",
  labelNames: ["query"] as const,
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register],
});

export const jobQueuePendingTotal = new client.Gauge({
  name: "job_queue_pending_total",
  help: "Total number of pending jobs in queue",
  labelNames: ["job_name"] as const,
  registers: [register],
});

export const jobQueueFailedTotal = new client.Counter({
  name: "job_queue_failed_total",
  help: "Total number of failed jobs in queue",
  labelNames: ["job_name"] as const,
  registers: [register],
});

export const jobDurationSeconds = new client.Histogram({
  name: "job_duration_seconds",
  help: "Job execution duration in seconds",
  labelNames: ["job_name"] as const,
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30, 60],
  registers: [register],
});

export async function updateJobQueuePendingMetrics(): Promise<void> {
  try {
    const { query } = await import("../db/index.js");
    const rows = await query<{ name: string; count: string }>(
      `SELECT name, COUNT(*)::text AS count
       FROM pgboss.job
       WHERE state IN ('created', 'retry')
       GROUP BY name`,
    );
    jobQueuePendingTotal.reset();
    for (const row of rows) {
      jobQueuePendingTotal.set({ job_name: row.name }, parseInt(row.count, 10));
    }
  } catch {
    // Ignore errors when database is unavailable in test environments
  }
}

export async function getMetrics(): Promise<string> {
  await updateJobQueuePendingMetrics();
  return register.metrics();
}

/**
 * Map an HTTP status onto the coarse class used as the `statusClass` label.
 * Returns null for anything that is not a 4xx/5xx so success responses never
 * reach the error counter.
 */
export function httpStatusClass(statusCode: number): "4xx" | "5xx" | null {
  if (!Number.isFinite(statusCode)) return null;
  if (statusCode >= 400 && statusCode < 500) return "4xx";
  if (statusCode >= 500 && statusCode < 600) return "5xx";
  return null;
}

/**
 * Increment http_errors_total for a single error response (#831).
 *
 * `route` is the matched route pattern when Express resolved one, otherwise
 * the request path. Never throws: metrics must not be able to turn a handled
 * error into a failed response.
 */
export function recordHttpError(route: string | undefined, statusCode: number): void {
  const statusClass = httpStatusClass(statusCode);
  if (statusClass === null) return;

  try {
    httpErrorsTotal.inc({ statusClass, route: route || "unknown" });
  } catch {
    // Ignore: never let a metrics failure affect the response
  }
}



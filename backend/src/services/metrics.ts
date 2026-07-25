import client from "prom-client";

const register = new client.Registry();

client.collectDefaultMetrics({ register });

export const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status"] as const,
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

export async function getMetrics(): Promise<string> {
  return register.metrics();
}

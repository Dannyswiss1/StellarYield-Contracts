import { readFileSync } from "fs";
import { Router } from "express";
import { pool } from "../../db/index.js";
import { config } from "../../config.js";
import { readTotalVaults } from "../../services/stellar.js";
import { sseManager } from "../../services/sseManager.js";

const { version } = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf-8"),
) as { version: string };

export const healthRouter = Router();

const FACTORY_HEALTH_CHECK_TIMEOUT_MS = 3000;

/**
 * Check whether the factory contract is reachable via a lightweight view
 * call, bounded by a timeout so a stalled RPC never blocks /health (#844).
 */
async function checkFactoryReachable(contractId: string): Promise<boolean> {
  try {
    await Promise.race([
      readTotalVaults(contractId),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error("factory reachability check timed out")), FACTORY_HEALTH_CHECK_TIMEOUT_MS),
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}

healthRouter.get("/", async (_req, res) => {
  // Surface connection pool utilisation so operators can detect connection
  // exhaustion before it causes query timeouts (#657). `waiting > 0` means
  // requests are queued for a connection — a sign of pool pressure.
  const dbPool = {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };

  const contractId = config.stellar.vaultFactoryContractId || null;
  const factory = {
    reachable: contractId !== null && (await checkFactoryReachable(contractId)),
    contractId,
  };
  const sseConnections = sseManager.getSseConnectionCount();

  try {
    await pool.query("SELECT 1");
    res.json({ version, status: "ok", dbPool, factory, sseConnections });
  } catch {
    res.status(503).json({ version, status: "error", dbPool, factory, sseConnections });
  }
});

const DEPENDENCY_CHECK_TIMEOUT_MS = 3000;

interface DependencyStatus {
  status: "ok" | "error" | "unconfigured";
  latencyMs: number | null;
  error?: string;
}

/** Run one dependency probe, bounded by a timeout, and record how long it took. */
async function probe(check: () => Promise<unknown>): Promise<DependencyStatus> {
  const started = Date.now();
  try {
    await Promise.race([
      check(),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error("timed out")), DEPENDENCY_CHECK_TIMEOUT_MS),
      ),
    ]);
    return { status: "ok", latencyMs: Date.now() - started };
  } catch (err) {
    return {
      status: "error",
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Per-dependency health (#1135): reports the database, the Stellar RPC and the
 * vault factory contract separately, each with its own latency, so an operator
 * can tell which one is down. Returns 503 if any configured dependency fails.
 */
healthRouter.get("/dependencies", async (_req, res) => {
  const contractId = config.stellar.vaultFactoryContractId || null;

  const [database, stellarRpc, factory] = await Promise.all([
    probe(() => pool.query("SELECT 1")),
    probe(async () => {
      const response = await fetch(config.stellar.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    }),
    contractId
      ? probe(() => readTotalVaults(contractId))
      : Promise.resolve<DependencyStatus>({ status: "unconfigured", latencyMs: null }),
  ]);

  const dependencies = { database, stellarRpc, factory };
  const healthy = Object.values(dependencies).every((d) => d.status !== "error");
  res.status(healthy ? 200 : 503).json({
    version,
    status: healthy ? "ok" : "error",
    dependencies,
  });
});

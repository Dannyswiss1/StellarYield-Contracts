import { createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { query } from "../../db/index.js";
import { indexer } from "../../services/indexerSingleton.js";
import { jobQueue } from "../../services/jobQueue.js";
import { sseManager } from "../../services/sseManager.js";
import { logger } from "../../logger.js";
import { z } from "zod";

const stellarAddressSchema = z.string().length(56).regex(/^G[A-Z2-7]{55}$/);
const contractAddressSchema = z.string().length(56).regex(/^C[A-Z2-7]{55}$/);

function getClientIp(req: Request): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0]?.trim() || null;
  }
  if (Array.isArray(forwarded)) {
    return forwarded[0] ?? null;
  }
  return req.ip ?? null;
}

function getRequestBodyHash(body: unknown): string {
  const normalized = typeof body === "string"
    ? body
    : body == null
      ? ""
      : JSON.stringify(body);
  return createHash("sha256").update(normalized).digest("hex");
}

async function logAdminAudit(req: Request, action: string, target: string): Promise<void> {
  await query(
    `INSERT INTO admin_audit_log (api_key_label, action, target, ip_address, request_body_hash, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [req.apiKey?.label ?? null, action, target, getClientIp(req), getRequestBodyHash(req.body)],
  );
}

export async function getAdminStats(_req: Request, res: Response, next: NextFunction) {
  try {
    const vaultCountRows = await query<{ count: string }>("SELECT COUNT(*)::text as count FROM vaults");
    const userCountRows = await query<{ count: string }>("SELECT COUNT(*)::text as count FROM users");
    const totalAssetsRows = await query<{ total: string }>("SELECT COALESCE(SUM(total_assets::numeric), 0)::text as total FROM vaults");
    const epochCountRows = await query<{ count: string }>("SELECT COUNT(*)::text as count FROM epochs");

    const vaultCount = parseInt(vaultCountRows[0]?.count ?? "0", 10);
    const userCount = parseInt(userCountRows[0]?.count ?? "0", 10);
    const totalValueLocked = totalAssetsRows[0]?.total ?? "0";
    const epochCount = parseInt(epochCountRows[0]?.count ?? "0", 10);

    res.json({ vaultCount, userCount, totalValueLocked, epochCount });
  } catch (err) {
    next(err);
  }
}

export async function getAdminIndexer(_req: Request, res: Response, next: NextFunction) {
  try {
    const running = indexer.isRunning();
    const lastLedger = await indexer.getLastIndexedLedger();
    const lastTickAtDate = indexer.getLastTickAt();
    const lastTickAt = lastTickAtDate ? lastTickAtDate.toISOString() : null;
    const eventsIndexed = await indexer.getEventsIndexedCount();

    res.json({ running, lastLedger, lastTickAt, eventsIndexed });
  } catch (err) {
    next(err);
  }
}

export async function backfillIndexer(req: Request, res: Response, next: NextFunction) {
  try {
    const backfillSchema = z.object({
      fromLedger: z.number().int().min(0),
      toLedger: z.number().int().min(0),
    });

    const parsed = backfillSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "BadRequest", message: "Invalid request body" });
      return;
    }

    const { fromLedger, toLedger } = parsed.data;

    if (fromLedger >= toLedger) {
      res.status(400).json({ error: "BadRequest", message: "fromLedger must be less than toLedger" });
      return;
    }

    if (toLedger - fromLedger > 10000) {
      res.status(400).json({ error: "BadRequest", message: "Range cannot exceed 10000 ledgers" });
      return;
    }

    await logAdminAudit(req, "backfill_indexer", "/api/v1/admin/indexer/backfill");

    // Queue the backfill asynchronously (non-blocking)
    indexer.queueBackfill(fromLedger, toLedger).catch((err) => {
      logger.error({ err }, "Backfill error");
    });

    res.status(202).json({ queued: true, fromLedger, toLedger });
  } catch (err) {
    next(err);
  }
}

export async function deleteApiKey(req: Request, res: Response, next: NextFunction) {
  try {
    const keyId = String(req.params["id"]);
    const idNum = parseInt(keyId, 10);

    if (isNaN(idNum) || idNum <= 0) {
      res.status(400).json({ error: "BadRequest", message: "Invalid key ID" });
      return;
    }

    const rows = await query<{ id: number }>("SELECT id FROM api_keys WHERE id = $1", [idNum]);

    if (rows.length === 0) {
      res.status(404).json({ error: "NotFound", message: "API key not found" });
      return;
    }

    await query("DELETE FROM api_keys WHERE id = $1", [idNum]);
    await logAdminAudit(req, "delete_api_key", `/api/v1/admin/api-keys/${idNum}`);

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function getApiKeys(_req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await query<{
      id: number;
      label: string | null;
      role: string;
      created_at: Date;
      expires_at: Date | null;
    }>(
      "SELECT id, label, role, created_at, expires_at FROM api_keys ORDER BY created_at DESC",
    );

    res.json(
      rows.map((row) => ({
        id: row.id,
        label: row.label,
        role: row.role,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      })),
    );
  } catch (err) {
    next(err);
  }
}

export async function getWebhookDeliveries(req: Request, res: Response, next: NextFunction) {
  try {
    const webhookId = parseInt(req.params["id"] as string, 10);
    if (isNaN(webhookId) || webhookId <= 0) {
      res.status(400).json({ error: "BadRequest", message: "Invalid webhook ID" });
      return;
    }

    const webhookRows = await query<{ id: number }>("SELECT id FROM webhooks WHERE id = $1", [webhookId]);
    if (webhookRows.length === 0) {
      res.status(404).json({ error: "NotFound", message: "Webhook not found" });
      return;
    }

    const rawPage = parseInt(String(req.query["page"] ?? "1"), 10);
    const page = Math.max(1, isNaN(rawPage) ? 1 : rawPage);
    const rawPageSize = parseInt(String(req.query["pageSize"] ?? "20"), 10);
    const pageSize = Math.max(1, Math.min(50, isNaN(rawPageSize) ? 20 : rawPageSize));
    const offset = (page - 1) * pageSize;

    const countRows = await query<{ count: string }>(
      "SELECT COUNT(*)::text as count FROM webhook_deliveries WHERE webhook_id = $1",
      [webhookId],
    );
    const total = parseInt(countRows[0]?.count ?? "0", 10);

    const rows = await query<{
      id: number;
      attempt: number;
      delivered_at: Date | null;
      last_error: string | null;
      next_retry_at: Date | null;
      created_at: Date;
    }>(
      `SELECT id, attempt, delivered_at, last_error, next_retry_at, created_at
       FROM webhook_deliveries
       WHERE webhook_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [webhookId, pageSize, offset],
    );

    res.json({
      data: rows.map((r) => ({
        id: r.id,
        attempt: r.attempt,
        deliveredAt: r.delivered_at,
        lastError: r.last_error,
        nextRetryAt: r.next_retry_at,
        createdAt: r.created_at,
      })),
      total,
      page,
      pageSize,
    });
  } catch (err) {
    next(err);
  }
}

export async function getAdminEvents(req: Request, res: Response, next: NextFunction) {
  try {
    const { contractId, eventType } = req.query as Record<string, string | undefined>;
    const params: any[] = [];
    const where: string[] = [];

    if (contractId) {
      params.push(contractId);
      where.push(`contract_id = $${params.length}`);
    }
    if (eventType) {
      params.push(eventType);
      where.push(`event_type = $${params.length}`);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = await query(
      `SELECT id, ledger, tx_hash, contract_id, event_type, payload, created_at
       FROM indexed_events
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT 50`,
      params,
    );

    res.json(rows);
  } catch (err) {
    next(err);
  }
}

export async function getVaultAudit(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = contractAddressSchema.safeParse(req.params["contractId"]);
    if (!parsed.success) {
      res.status(400).json({ error: "BadRequest", message: "Invalid contractId format" });
      return;
    }
    const contractId = parsed.data;

    const rawLimit = parseInt(String(req.query["limit"] ?? "50"), 10);
    const limit = Math.max(1, Math.min(200, isNaN(rawLimit) ? 50 : rawLimit));
    const rawOffset = parseInt(String(req.query["offset"] ?? "0"), 10);
    const offset = Math.max(0, isNaN(rawOffset) ? 0 : rawOffset);
    const eventType = typeof req.query["eventType"] === "string" ? req.query["eventType"] : undefined;

    const params: any[] = [contractId, limit, offset];
    const eventTypeFilter = eventType ? `AND event_type = $${params.push(eventType)}` : "";

    const rows = await query(
      `SELECT id, ledger, tx_hash, contract_id, event_type, payload, created_at
         FROM indexed_events
        WHERE contract_id = $1
              ${eventTypeFilter}
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3`,
      params,
    );

    const countParams: any[] = [contractId];
    const countEventTypeFilter = eventType ? `AND event_type = $${countParams.push(eventType)}` : "";
    const countRows = await query<{ count: string }>(
      `SELECT COUNT(*)::text as count
         FROM indexed_events
        WHERE contract_id = $1
              ${countEventTypeFilter}`,
      countParams,
    );
    const total = parseInt(countRows[0]?.count ?? "0", 10);

    res.json({ data: rows, total, limit, offset });
  } catch (err) {
    next(err);
  }
}

export async function getAdminFeesDashboard(req: Request, res: Response, next: NextFunction) {
  try {
    const from = typeof req.query["from"] === "string" ? req.query["from"] : undefined;
    const to = typeof req.query["to"] === "string" ? req.query["to"] : undefined;

    const parsedDateFilters: { column: string; value: string; operator: string }[] = [];
    const dateParams: string[] = [];

    const parseDate = (value: string | undefined, label: "from" | "to") => {
      if (!value) return undefined;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error(`Invalid ${label} date`);
      }
      return parsed.toISOString();
    };

    const fromDate = parseDate(from, "from");
    const toDate = parseDate(to, "to");

    if (fromDate) {
      parsedDateFilters.push({ column: "ie.created_at", value: fromDate, operator: ">=" });
      dateParams.push(fromDate);
    }
    if (toDate) {
      parsedDateFilters.push({ column: "ie.created_at", value: toDate, operator: "<=" });
      dateParams.push(toDate);
    }

    const dateWhereClause = parsedDateFilters.length > 0
      ? `WHERE ${parsedDateFilters.map((filter, index) => `${filter.column} ${filter.operator} $${index + 1}`).join(" AND ")}`
      : "";
    const dateFilterSuffix = dateWhereClause ? " AND " : " WHERE ";

    const feeSubquery = `SELECT
        ie.contract_id,
        COALESCE(SUM((ie.parsed_data->>'operatorFee')::numeric), 0)::text AS total_operator_fees
      FROM indexed_events ie
      ${dateWhereClause}${dateFilterSuffix}ie.event_type = 'yield_distributed'
      AND ie.parsed_data IS NOT NULL
      GROUP BY ie.contract_id`;

    const lastFeeSubquery = `SELECT ranked.contract_id, ranked.operator_fee
      FROM (
        SELECT
          ie.contract_id,
          COALESCE((ie.parsed_data->>'operatorFee')::text, '0') AS operator_fee,
          row_number() OVER (PARTITION BY ie.contract_id ORDER BY ie.created_at DESC, ie.id DESC) AS rn
        FROM indexed_events ie
        ${dateWhereClause}${dateFilterSuffix}ie.event_type = 'yield_distributed'
        AND ie.parsed_data IS NOT NULL
      ) ranked
      WHERE ranked.rn = 1`;

    const rows = await query<{
      contract_id: string;
      name: string | null;
      fee_bps: number | null;
      total_operator_fees: string;
      epoch_count: string;
      last_epoch_fee: string;
    }>(
      `SELECT
         v.contract_id,
         v.name,
         COALESCE(v.operator_fee_bps, 0) AS fee_bps,
         COALESCE(f.total_operator_fees, '0') AS total_operator_fees,
         COALESCE(e.epoch_count, 0)::text AS epoch_count,
         COALESCE(lf.operator_fee, '0') AS last_epoch_fee
       FROM vaults v
       LEFT JOIN (${feeSubquery}) f ON f.contract_id = v.contract_id
       LEFT JOIN (
         SELECT vault_id, COUNT(*)::text AS epoch_count
         FROM epochs
         GROUP BY vault_id
       ) e ON e.vault_id = v.id
       LEFT JOIN (${lastFeeSubquery}) lf ON lf.contract_id = v.contract_id
       ORDER BY COALESCE(f.total_operator_fees, '0')::numeric DESC`,
      dateParams,
    );

    res.json(rows.map((row) => ({
      contractId: row.contract_id,
      name: row.name,
      totalOperatorFees: row.total_operator_fees,
      epochCount: parseInt(row.epoch_count ?? "0", 10),
      feeBps: row.fee_bps ?? 0,
      lastEpochFee: row.last_epoch_fee ?? "0",
    })));
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Invalid ")) {
      res.status(400).json({ error: "BadRequest", message: err.message });
      return;
    }
    next(err);
  }
}

export async function deleteUser(req: Request, res: Response, next: NextFunction) {
  try {
    const address = String(req.params["address"]);

    const existingRows = await query<{ id: number }>("SELECT id FROM users WHERE address = $1", [address]);
    if (existingRows.length === 0) {
      res.status(404).json({ error: "NotFound", message: "User not found" });
      return;
    }

    const redactedAddress = "[REDACTED]";
    const tables = ["user_vault_positions", "share_balance_snapshots", "redemption_requests"];

    let recordsAffected = 0;
    for (const table of tables) {
      const updated = await query<{ id: number }>(
        `UPDATE ${table} SET user_address = $1 WHERE user_address = $2 RETURNING id`,
        [redactedAddress, address],
      );
      recordsAffected += updated.length;
    }

    // Anonymise historical blockchain events referencing this address, without deleting the events themselves.
    const redactedUserEvents = await query<{ id: number }>(
      `UPDATE indexed_events SET payload = jsonb_set(payload, '{user}', '"[REDACTED]"')
       WHERE payload->>'user' = $1
       RETURNING id`,
      [address],
    );
    recordsAffected += redactedUserEvents.length;

    const redactedAddressEvents = await query<{ id: number }>(
      `UPDATE indexed_events SET payload = jsonb_set(payload, '{address}', '"[REDACTED]"')
       WHERE payload->>'address' = $1
       RETURNING id`,
      [address],
    );
    recordsAffected += redactedAddressEvents.length;

    await query("DELETE FROM users WHERE address = $1", [address]);
    await logAdminAudit(req, "delete_user", `/api/v1/admin/users/${address}`);

    const deletedAt = new Date().toISOString();

    res.json({ address, deletedAt, recordsAffected });
  } catch (err) {
    next(err);
  }
}

export async function getAdminAuditLog(req: Request, res: Response, next: NextFunction) {
  try {
    const rawPage = parseInt(String(req.query["page"] ?? "1"), 10);
    const page = Math.max(1, isNaN(rawPage) ? 1 : rawPage);
    const rawPageSize = parseInt(String(req.query["pageSize"] ?? "20"), 10);
    const pageSize = Math.max(1, Math.min(100, isNaN(rawPageSize) ? 20 : rawPageSize));
    const offset = (page - 1) * pageSize;

    const countRows = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM admin_audit_log");
    const total = parseInt(countRows[0]?.count ?? "0", 10);

    const rows = await query<{
      id: number;
      api_key_label: string | null;
      action: string;
      target: string;
      ip_address: string | null;
      request_body_hash: string;
      created_at: Date;
    }>(
      `SELECT id, api_key_label, action, target, ip_address, request_body_hash, created_at
       FROM admin_audit_log
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset],
    );

    res.json({
      data: rows.map((row) => ({
        id: row.id,
        apiKeyLabel: row.api_key_label,
        action: row.action,
        target: row.target,
        ipAddress: row.ip_address,
        requestBodyHash: row.request_body_hash,
        createdAt: row.created_at,
      })),
      total,
      page,
      pageSize,
    });
  } catch (err) {
    next(err);
  }
}

export async function getArchivedVaults(_req: Request, res: Response, next: NextFunction) {
  try {
    const { VaultService } = await import("../../services/vault.js");
    const vaultService = new VaultService();
    const vaults = await vaultService.listArchivedVaults();
    res.json(vaults);
  } catch (err) {
    next(err);
  }
}

export async function getTotalSupplyConsistency(req: Request, res: Response, next: NextFunction) {
  try {
    const contractId = req.query["contractId"] as string | undefined;

    if (!contractId) {
      res.status(400).json({ error: "Bad Request", message: "contractId query parameter is required" });
      return;
    }

    const { VaultService } = await import("../../services/vault.js");
    const { readTotalSupply } = await import("../../services/stellar.js");

    const vaultService = new VaultService();
    const vault = await vaultService.getVault(contractId);

    if (!vault) {
      res.status(404).json({ error: "Not Found", message: "Vault not found" });
      return;
    }

    const dbTotalSupply = BigInt(vault.totalSupply);

    let chainTotalSupply: bigint;
    try {
      chainTotalSupply = await readTotalSupply(contractId);
    } catch (err) {
      logger.error({ err, contractId }, "RPC error fetching chain total supply");
      res.status(502).json({ error: "Bad Gateway", message: "Failed to fetch chain data" });
      return;
    }

    const delta = chainTotalSupply - dbTotalSupply;
    const consistent = delta === 0n;

    res.json({
      dbTotalSupply: dbTotalSupply.toString(),
      chainTotalSupply: chainTotalSupply.toString(),
      delta: delta.toString(),
      consistent,
    });
  } catch (err) {
    next(err);
  }
}

export async function getDbStats(_req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await query<{
      relname: string;
      n_live_tup: string;
      total_bytes: string;
    }>(
      `SELECT
         relname,
         n_live_tup::text,
         pg_total_relation_size(relid)::text AS total_bytes
       FROM pg_stat_user_tables
       ORDER BY pg_total_relation_size(relid) DESC`,
    );

    res.json({
      tables: rows.map((r) => ({
        name: r.relname,
        rowEstimate: parseInt(r.n_live_tup, 10),
        totalSizeBytes: parseInt(r.total_bytes, 10),
      })),
    });
  } catch (err) {
    next(err);
  }
}

export async function getAdminFees(_req: Request, res: Response, next: NextFunction) {
  try {
    const operatorFeeRows = await query<{ total: string }>(
      `SELECT COALESCE(SUM((parsed_data->>'operatorFee')::numeric), 0)::text AS total
       FROM indexed_events
       WHERE event_type = 'yield_distributed' AND parsed_data IS NOT NULL`,
    );
    const totalOperatorFees = operatorFeeRows[0]?.total ?? "0";

    const redemptionFeeRows = await query<{ total: string }>(
      `SELECT COALESCE(SUM(fee_revenue), 0)::text AS total
       FROM redemption_requests
       WHERE processed = TRUE AND fee_revenue > 0`,
    );
    const totalEarlyRedemptionFees = redemptionFeeRows[0]?.total ?? "0";

    const totalOperatorBig = BigInt(Math.round(parseFloat(totalOperatorFees)));
    const totalRedemptionBig = BigInt(Math.round(parseFloat(totalEarlyRedemptionFees)));
    const totalPlatformRevenue = (totalOperatorBig + totalRedemptionBig).toString();

    const topFeeVaults = await query<{ contract_id: string; total_fees: string }>(
      `SELECT
         ie.contract_id,
         COALESCE(SUM((ie.parsed_data->>'operatorFee')::numeric), 0)::text AS total_fees
       FROM indexed_events ie
       WHERE ie.event_type = 'yield_distributed' AND ie.parsed_data IS NOT NULL
       GROUP BY ie.contract_id
       ORDER BY SUM((ie.parsed_data->>'operatorFee')::numeric) DESC
       LIMIT 5`,
    );

    res.json({
      totalOperatorFees: totalOperatorBig.toString(),
      totalEarlyRedemptionFees: totalRedemptionBig.toString(),
      totalPlatformRevenue,
      topFeeVaults: topFeeVaults.map((v) => ({
        contractId: v.contract_id,
        totalFees: v.total_fees,
      })),
    });
  } catch (err) {
    next(err);
  }
}

export async function flagUserAml(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = stellarAddressSchema.safeParse(req.params["address"]);
    if (!parsed.success) {
      res.status(400).json({ error: "BadRequest", message: "Invalid address format" });
      return;
    }
    const address = parsed.data;

    const rows = await query<{ id: number }>(
      "SELECT id FROM users WHERE address = $1",
      [address],
    );
    if (rows.length === 0) {
      res.status(404).json({ error: "NotFound", message: "User not found" });
      return;
    }

    await query(
      `UPDATE users SET aml_flagged = TRUE, aml_flagged_at = NOW(), updated_at = NOW()
       WHERE address = $1`,
      [address],
    );

    res.json({ address, amlFlagged: true });
  } catch (err) {
    next(err);
  }
}

export async function clearUserAml(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = stellarAddressSchema.safeParse(req.params["address"]);
    if (!parsed.success) {
      res.status(400).json({ error: "BadRequest", message: "Invalid address format" });
      return;
    }
    const address = parsed.data;

    const rows = await query<{ id: number }>(
      "SELECT id FROM users WHERE address = $1",
      [address],
    );
    if (rows.length === 0) {
      res.status(404).json({ error: "NotFound", message: "User not found" });
      return;
    }

    await query(
      `UPDATE users SET aml_flagged = FALSE, aml_flagged_at = NULL, updated_at = NOW()
       WHERE address = $1`,
      [address],
    );

    res.json({ address, amlFlagged: false });
  } catch (err) {
    next(err);
  }
}

export async function getFlaggedUsers(_req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await query<{
      address: string;
      aml_flagged_at: Date;
      total_deposited: string;
      kyc_verified: boolean;
    }>(
      `SELECT
         u.address,
         u.aml_flagged_at,
         COALESCE(SUM(uvp.deposited), 0)::text AS total_deposited,
         u.kyc_verified
       FROM users u
       LEFT JOIN user_vault_positions uvp ON uvp.user_address = u.address
       WHERE u.aml_flagged = TRUE
       GROUP BY u.address, u.aml_flagged_at, u.kyc_verified
       ORDER BY u.aml_flagged_at DESC`,
    );

    res.json(
      rows.map((r) => ({
        address: r.address,
        amlFlaggedAt: r.aml_flagged_at,
        totalDeposited: r.total_deposited,
        kycVerified: r.kyc_verified,
      })),
    );
  } catch (err) {
    next(err);
  }
}

export async function getPositionsSnapshot(req: Request, res: Response, next: NextFunction) {
  try {
    const asOfParam = req.query["asOf"] as string | undefined;
    const contractIdParam = req.query["contractId"] as string | undefined;
    const formatParam = req.query["format"] as string | undefined;

    if (!asOfParam) {
      res.status(400).json({ error: "BadRequest", message: "asOf query parameter is required (ISO 8601)" });
      return;
    }

    const asOf = new Date(asOfParam);
    if (isNaN(asOf.getTime())) {
      res.status(400).json({ error: "BadRequest", message: "Invalid asOf timestamp" });
      return;
    }

    if (contractIdParam) {
      const cidParsed = contractAddressSchema.safeParse(contractIdParam);
      if (!cidParsed.success) {
        res.status(400).json({ error: "BadRequest", message: "Invalid contractId format" });
        return;
      }
    }

    const params: unknown[] = [asOf.toISOString()];
    let contractFilter = "";
    if (contractIdParam) {
      params.push(contractIdParam);
      contractFilter = `AND v.contract_id = $${params.length}`;
    }

    const rows = await query<{
      user_address: string;
      vault_contract_id: string;
      shares: string;
      recorded_at: Date;
    }>(
      `SELECT DISTINCT ON (sbs.user_address, sbs.vault_id)
         sbs.user_address,
         v.contract_id AS vault_contract_id,
         sbs.shares::text AS shares,
         sbs.recorded_at
       FROM share_balance_snapshots sbs
       JOIN vaults v ON sbs.vault_id = v.id
       WHERE sbs.recorded_at <= $1
         ${contractFilter}
       ORDER BY sbs.user_address, sbs.vault_id, sbs.epoch DESC`,
      params,
    );

    if (formatParam === "csv") {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="positions-snapshot-${asOf.toISOString()}.csv"`);
      const header = "user_address,vault_contract_id,shares,recorded_at\n";
      const csvBody = rows
        .map((r) => `${r.user_address},${r.vault_contract_id},${r.shares},${r.recorded_at.toISOString()}`)
        .join("\n");
      res.send(header + csvBody);
      return;
    }

    res.json(
      rows.map((r) => ({
        userAddress: r.user_address,
        vaultContractId: r.vault_contract_id,
        shares: r.shares,
        recordedAt: r.recorded_at,
      })),
    );
  } catch (err) {
    next(err);
  }
}

export async function getJobStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const jobId = req.params["jobId"] as string;

    const job = await jobQueue.getJob(jobId);
    if (!job) {
      res.status(404).json({ error: "NotFound", message: "Job not found" });
      return;
    }

    res.json({
      id: job.id,
      name: job.name,
      state: job.state,
      createdAt: job.createdOn,
      completedOn: job.completedOn,
      output: job.output,
    });
  } catch (err) {
    next(err);
  }
}

export async function getFailedJobs(_req: Request, res: Response, next: NextFunction) {
  try {
    const jobs = await jobQueue.getFailedJobs(50);

    res.json({
      data: jobs.map((job) => ({
        id: job.id,
        name: job.name,
        payload: job.data,
        createdAt: job.createdOn,
        completedAt: job.completedOn,
        output: job.output,
      })),
    });
  } catch (err) {
    next(err);
  }
}

/** SSE stream of indexer tick progress (#757). */
export function streamIndexerProgress(req: Request, res: Response): void {
  sseManager.addIndexerClient(req, res);
}

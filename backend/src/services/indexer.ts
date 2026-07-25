import { xdr, scValToNative } from "@stellar/stellar-sdk";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { query } from "../db/index.js";
import { getSorobanRpc } from "./stellar.js";
import { VaultService } from "./vault.js";
import { NotificationService } from "./notifications.js";
import { userServiceInstance } from "./userSingleton.js";

// ── Upstream helpers ───────────────────────────────────────────────────────────

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getEventTopics(rawEvent: any): unknown[] | null {
  const topics = rawEvent?.topic ?? rawEvent?.topics;
  return Array.isArray(topics) ? topics : null;
}

function getEventData(rawEvent: any): unknown | null {
  return rawEvent?.value ?? rawEvent?.data ?? null;
}

function parseRawEventName(rawEvent: any): { topics: unknown[]; data: unknown } | null {
  const topics = getEventTopics(rawEvent);
  const data = getEventData(rawEvent);
  if (!topics || data === null) return null;
  return { topics, data };
}

async function withBackoff<T>(
  fn: () => Promise<T>,
  retries = 5,
  startDelayMs = 1000,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      const is429 =
        err?.response?.status === 429 ||
        err?.status === 429 ||
        String(err?.message ?? "").includes("429");
      if (!is429 || attempt >= retries) throw err;
      const delayMs = Math.min(startDelayMs * Math.pow(2, attempt), 60_000);
      logger.warn(
        { attempt: attempt + 1, delayMs },
        "RPC 429 rate-limit; retrying with backoff",
      );
      await wait(delayMs);
      attempt++;
    }
  }
}

// ── Decode helpers (exported for testing) ─────────────────────────────────────

export function decodeSymbol(topic: any): string {
  try {
    return String(scValToNative(topic) ?? "");
  } catch {
    return "";
  }
}

export function decodeAddr(topic: any): string {
  try {
    const v = scValToNative(topic);
    return typeof v === "string" ? v : String(v ?? "");
  } catch {
    return "";
  }
}

export function decodeBigInt(val: unknown): bigint {
  if (typeof val === "bigint") return val;
  if (typeof val === "number") return BigInt(Math.trunc(val));
  if (typeof val === "string" && /^-?\d+$/.test(val)) return BigInt(val);
  if (Array.isArray(val) && val.length > 0) return decodeBigInt(val[0]);
  if (val && typeof val === "object") {
    const first = Object.values(val as Record<string, unknown>)[0];
    if (first !== undefined) return decodeBigInt(first);
  }
  return 0n;
}

export function decodeValue(ev: any): unknown {
  try {
    return scValToNative(ev.value);
  } catch {
    return null;
  }
}

export async function storeIndexedEvent(
  contractId: string,
  eventType: string,
  ev: any,
  payload: Record<string, unknown>,
): Promise<void> {
  await query(
    `INSERT INTO indexed_events (ledger, tx_hash, contract_id, event_type, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [ev.ledger, ev.txHash, contractId, eventType, JSON.stringify(payload)],
  );
}

// ── Indexer ────────────────────────────────────────────────────────────────────

export class Indexer {
  lastLedger: number;
  private running = false;
  private lastTickAt: Date | null = null;
  private readonly vaultFactoryContractId: string;
  private vaultService: VaultService;
  private notificationService?: NotificationService;

  constructor(notificationService?: NotificationService) {
    this.lastLedger = config.indexer.startLedger;
    this.vaultFactoryContractId = config.stellar.vaultFactoryContractId;
    this.vaultService = new VaultService();
    this.notificationService = notificationService;

    if (!this.vaultFactoryContractId) {
      logger.warn(
        "VAULT_FACTORY_CONTRACT_ID is not configured. Event polling will be skipped. " +
        "Only indexer_state will be updated. Please set VAULT_FACTORY_CONTRACT_ID to enable event indexing.",
      );
    }
  }

  async start(): Promise<void> {
    this.running = true;

    try {
      this.lastLedger = await this.getLastIndexedLedger();
      logger.info({ ledger: this.lastLedger }, `resuming from ledger ${this.lastLedger}`);

      if (!this.vaultFactoryContractId) {
        logger.info("Indexer started in state-only mode (no contract ID configured)");
        while (this.running) {
          await this.tickStateOnly();
          await this.sleepWhileRunning(config.indexer.pollIntervalMs);
        }
        return;
      }

      const server = getSorobanRpc();
      const { sequence: tipLedger } = await withBackoff(() => server.getLatestLedger());
      const gap = tipLedger - this.lastLedger;

      if (gap > config.indexer.batchSize) {
        await this.backfill(tipLedger);
      }

      while (this.running) {
        await this.tick();
        await this.sleepWhileRunning(config.indexer.pollIntervalMs);
      }
    } catch (err) {
      logger.error({ err }, "Indexer failed to start");
    } finally {
      this.running = false;
    }
  }

  stop(): void {
    this.running = false;
  }

  private async tickStateOnly(): Promise<void> {
    const server = getSorobanRpc();

    let latestLedger: number;
    try {
      const resp = await withBackoff(() => server.getLatestLedger());
      latestLedger = resp.sequence;
    } catch (err) {
      logger.warn({ err }, "RPC error fetching latest ledger during state-only tick");
      return;
    }

    if (latestLedger <= this.lastLedger) {
      logger.info({ latestLedger, lastLedger: this.lastLedger }, "no new ledgers");
      this.lastTickAt = new Date();
      return;
    }

    this.lastLedger = latestLedger;
    await this.saveLastIndexedLedger(latestLedger);
    logger.info({ ledger: latestLedger }, "state-only tick complete");
    this.lastTickAt = new Date();
  }

  async tick(): Promise<void> {
    const server = getSorobanRpc();

    let latestLedger: number;
    try {
      const resp = await withBackoff(() => server.getLatestLedger());
      latestLedger = resp.sequence;
    } catch (err) {
      logger.warn({ err }, "RPC error fetching latest ledger during tick");
      return;
    }

    if (latestLedger <= this.lastLedger) return;

    const from = this.lastLedger + 1;
    const filters = this.vaultFactoryContractId
      ? [{ contractIds: [this.vaultFactoryContractId] }]
      : [];

    let events: any[];
    try {
      const resp = await withBackoff(() =>
        server.getEvents({ startLedger: from, filters }),
      );
      events = resp.events;
    } catch (err) {
      logger.warn({ err, from, to: latestLedger }, "RPC error fetching events during tick");
      return;
    }

    logger.info(
      { from, to: latestLedger, eventCount: events.length },
      "Indexer tick complete",
    );

    for (const event of events) {
      logger.debug(
        { contractId: event.contractId, type: event.type, ledger: event.ledger },
        "Processing event",
      );
      await this.processEvent(event);
    }

    this.lastLedger = latestLedger;
    await this.persistLastLedger();
    this.lastTickAt = new Date();
  }

  private async backfill(tipLedger: number): Promise<void> {
    const batchSize = config.indexer.batchSize;
    const server = getSorobanRpc();
    let cursor = this.lastLedger;

    const filters = this.vaultFactoryContractId
      ? [{ contractIds: [this.vaultFactoryContractId] }]
      : [];

    while (cursor < tipLedger) {
      const batchTo = Math.min(cursor + batchSize, tipLedger);
      const remaining = tipLedger - batchTo;

      logger.info(
        { from: cursor + 1, to: batchTo, remaining },
        `Backfilling ledgers ${cursor + 1}–${batchTo} (${remaining} remaining)`,
      );

      try {
        const resp = await withBackoff(() =>
          server.getEvents({ startLedger: cursor + 1, filters }),
        );

        for (const event of resp.events) {
          logger.debug(
            { contractId: event.contractId, type: event.type, ledger: event.ledger },
            "Backfill event",
          );
          await this.processEvent(event);
        }

        cursor = batchTo;
        this.lastLedger = cursor;
        await this.persistLastLedger();
        this.lastTickAt = new Date();
      } catch (err) {
        logger.warn({ err, from: cursor + 1, to: batchTo }, "RPC error during backfill batch");
        break;
      }
    }
  }

  async processEvent(event: any): Promise<void> {
    const existing = await query(
      "SELECT id FROM indexed_events WHERE tx_hash = $1 AND contract_id = $2 AND event_type = $3 AND ledger = $4",
      [event.id ?? event.txHash ?? "", event.contractId ?? "", event.type ?? "", event.ledger ?? 0],
    );
    if (existing.length > 0) return;

    const deposit = parseDepositEvent(event);
    if (deposit) {
      await this.handleDeposit(event.contractId ?? "", deposit);
      await this.recordEvent(event, "deposit");
      try {
        await this.notificationService?.notify("deposit", deposit as any);
      } catch (e) {
        logger.warn({ err: e }, "NotificationService.notify failed for deposit");
      }
      return;
    }

    const withdraw = parseWithdrawEvent(event);
    if (withdraw) {
      await this.handleWithdraw(event.contractId ?? "", withdraw);
      await this.recordEvent(event, "withdraw");
      try {
        await this.notificationService?.notify("withdraw", withdraw as any);
      } catch (e) {
        logger.warn({ err: e }, "NotificationService.notify failed for withdraw");
      }
      return;
    }

    const yieldDist = parseYieldDistributedEvent(event);
    if (yieldDist) {
      await this.handleYieldDistributed(event.contractId ?? "", yieldDist);
      await this.recordEvent(event, "yield_distributed");
      try {
        await this.notificationService?.notify("yield_distributed", yieldDist as any);
      } catch (e) {
        logger.warn({ err: e }, "NotificationService.notify failed for yield_distributed");
      }
      return;
    }

    const vaultStateChanged = parseVaultStateChangedEvent(event);
    if (vaultStateChanged) {
      await this.recordEvent(event, "vault_state_changed");
      try {
        await this.notificationService?.notify("vault_state_changed", vaultStateChanged as any);
      } catch (e) {
        logger.warn({ err: e }, "NotificationService.notify failed for vault_state_changed");
      }
      return;
    }

    const vaultCreated = parseVaultCreatedEvent(event);
    if (vaultCreated) {
      await this.handleVaultCreated(event.contractId ?? "", vaultCreated);
      await this.recordEvent(event, "vault_created");
      try {
        await this.notificationService?.notify("vault_created", vaultCreated as any);
      } catch (e) {
        logger.warn({ err: e }, "NotificationService.notify failed for vault_created");
      }
      return;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  getLastTickAt(): Date | null {
    return this.lastTickAt;
  }

  async getEventsIndexedCount(): Promise<number> {
    const rows = await query<{ count: string }>("SELECT COUNT(*)::text as count FROM indexed_events");
    return parseInt(rows[0]?.count ?? "0", 10);
  }

  private async handleDeposit(
    contractId: string,
    deposit: { caller: string; receiver: string; assets: bigint; shares: bigint },
  ): Promise<void> {
    await query(
      `INSERT INTO user_vault_positions (user_address, vault_id, shares, deposited, updated_at)
       SELECT $1, v.id, $2, $3, NOW()
       FROM vaults v WHERE v.contract_id = $4
       ON CONFLICT (user_address, vault_id)
       DO UPDATE SET
         shares    = user_vault_positions.shares    + EXCLUDED.shares,
         deposited = user_vault_positions.deposited + EXCLUDED.deposited,
         updated_at = NOW()`,
      [deposit.receiver, deposit.shares.toString(), deposit.assets.toString(), contractId],
    );
    logger.info(
      { contractId, receiver: deposit.receiver, shares: deposit.shares.toString() },
      "Processed deposit event",
    );
    
    // Get updated position and emit SSE event
    const positionResult = await query<{ shares: string; deposited: string }>(
      `SELECT shares, deposited FROM user_vault_positions uvp
       JOIN vaults v ON uvp.vault_id = v.id
       WHERE uvp.user_address = $1 AND v.contract_id = $2`,
      [deposit.receiver, contractId],
    );
    if (positionResult.length > 0) {
      const { shares, deposited } = positionResult[0];
      userServiceInstance.emitPositionUpdate(deposit.receiver, contractId, shares, deposited);
    }
  }

  private async handleWithdraw(
    contractId: string,
    withdraw: { owner: string; assets: bigint; shares: bigint },
  ): Promise<void> {
    await query(
      `INSERT INTO user_vault_positions (user_address, vault_id, shares, deposited)
       SELECT $1, v.id, 0, 0
       FROM vaults v WHERE v.contract_id = $4
       ON CONFLICT (user_address, vault_id) DO UPDATE SET
         shares    = GREATEST(0, user_vault_positions.shares    - $2),
         deposited = GREATEST(0, user_vault_positions.deposited - $3),
         updated_at = NOW()`,
      [withdraw.owner, withdraw.shares.toString(), withdraw.assets.toString(), contractId],
    );
    logger.info(
      { contractId, owner: withdraw.owner, shares: withdraw.shares.toString() },
      "Processed withdraw event",
    );
    
    // Get updated position and emit SSE event
    const positionResult = await query<{ shares: string; deposited: string }>(
      `SELECT shares, deposited FROM user_vault_positions uvp
       JOIN vaults v ON uvp.vault_id = v.id
       WHERE uvp.user_address = $1 AND v.contract_id = $2`,
      [withdraw.owner, contractId],
    );
    if (positionResult.length > 0) {
      const { shares, deposited } = positionResult[0];
      userServiceInstance.emitPositionUpdate(withdraw.owner, contractId, shares, deposited);
    }
  }

  private async handleYieldDistributed(
    contractId: string,
    yieldDist: { epoch: number; amount: bigint; timestamp: bigint },
  ): Promise<void> {
    const vaultRow = await query<{ id: number }>(
      "SELECT id FROM vaults WHERE contract_id = $1",
      [contractId],
    );
    if (vaultRow.length === 0) {
      logger.warn({ contractId }, "yield_distributed for unknown vault — skipping epoch record");
      return;
    }
    const vaultId = vaultRow[0].id;

    const supplyRow = await query<{ total_supply: string }>(
      "SELECT total_supply FROM vaults WHERE id = $1",
      [vaultId],
    );
    const totalShares = supplyRow[0]?.total_supply ?? "0";

    await query(
      `INSERT INTO epochs (vault_id, epoch, yield_amount, total_shares, distributed_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (vault_id, epoch) DO NOTHING`,
      [vaultId, yieldDist.epoch, yieldDist.amount.toString(), totalShares],
    );
    logger.info(
      { contractId, epoch: yieldDist.epoch, amount: yieldDist.amount.toString() },
      "Processed yield_distributed event",
    );
  }

  private async handleVaultCreated(
    factoryId: string,
    vaultCreated: { contractId: string; asset: string; name: string; symbol: string },
  ): Promise<void> {
    logger.info(
      { vault: vaultCreated.contractId, factoryId, name: vaultCreated.name },
      "Processing vault_created event",
    );
    await this.vaultService.upsertVault({
      contractId: vaultCreated.contractId,
      factoryId,
      name: vaultCreated.name,
      asset: vaultCreated.asset,
      symbol: vaultCreated.symbol || null,
      state: "Funding",
    });
  }

  private async recordEvent(event: any, eventType: string): Promise<void> {
    await query(
      `INSERT INTO indexed_events (ledger, tx_hash, contract_id, event_type, payload)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [
        event.ledger ?? 0,
        event.id ?? event.txHash ?? "",
        event.contractId ?? "",
        eventType,
        JSON.stringify(event),
      ],
    );
  }

  private async persistLastLedger(): Promise<void> {
    await this.saveLastIndexedLedger(this.lastLedger);
  }

  async getLastIndexedLedger(): Promise<number> {
    const rows = await query<{ last_ledger: number }>(
      "SELECT last_ledger FROM indexer_state LIMIT 1",
    );
    return rows[0]?.last_ledger ?? config.indexer.startLedger;
  }

  async saveLastIndexedLedger(ledger: number): Promise<void> {
    await query(
      `INSERT INTO indexer_state (id, last_ledger) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET last_ledger = EXCLUDED.last_ledger, updated_at = NOW()`,
      [ledger],
    );
  }

  private async sleepWhileRunning(ms: number): Promise<void> {
    const stepMs = 250;
    let remaining = ms;
    while (this.running && remaining > 0) {
      const delayMs = Math.min(stepMs, remaining);
      await wait(delayMs);
      remaining -= delayMs;
    }
  }
}

// ── Standalone event parsers (exported for unit testing) ──────────────────────

export interface ParsedDepositEvent {
  caller: string;
  receiver: string;
  assets: bigint;
  shares: bigint;
}

export function parseDepositEvent(rawEvent: unknown): ParsedDepositEvent | null {
  try {
    if (!rawEvent || typeof rawEvent !== "object") return null;
    const ev = rawEvent as Record<string, unknown>;
    const topics = (ev["topic"] ?? ev["topics"]) as unknown[] | undefined;
    const value = ev["value"] ?? ev["data"];

    if (!Array.isArray(topics) || topics.length < 3 || value == null) return null;

    const parsedTopics = topics.map((t) =>
      typeof t === "string" ? xdr.ScVal.fromXDR(t, "base64") : (t as xdr.ScVal),
    );
    const parsedValue = typeof value === "string"
      ? xdr.ScVal.fromXDR(value, "base64")
      : value;

    let eventName: string;
    try {
      eventName = String(scValToNative(parsedTopics[0]) ?? "");
    } catch {
      return null;
    }
    if (eventName !== "deposit") return null;

    const caller = String(scValToNative(parsedTopics[1]) ?? "");
    const receiver = String(scValToNative(parsedTopics[2]) ?? "");

    const data = scValToNative(parsedValue as xdr.ScVal);
    const arr = Array.isArray(data) ? data : Object.values((data as Record<string, unknown>) ?? {});
    const assets = decodeBigInt(arr[0]);
    const shares = decodeBigInt(arr[1]);

    return { caller, receiver, assets, shares };
  } catch {
    return null;
  }
}

export interface ParsedWithdrawEvent {
  caller: string;
  receiver: string;
  owner: string;
  assets: bigint;
  shares: bigint;
}

export function parseWithdrawEvent(rawEvent: unknown): ParsedWithdrawEvent | null {
  try {
    if (!rawEvent || typeof rawEvent !== "object") return null;
    const ev = rawEvent as Record<string, unknown>;
    const topics = (ev["topic"] ?? ev["topics"]) as unknown[] | undefined;
    const value = ev["value"] ?? ev["data"];

    if (!Array.isArray(topics) || topics.length < 4 || value == null) return null;

    const parsedTopics = topics.map((t) =>
      typeof t === "string" ? xdr.ScVal.fromXDR(t, "base64") : (t as xdr.ScVal),
    );
    const parsedValue = typeof value === "string"
      ? xdr.ScVal.fromXDR(value, "base64")
      : value;

    let eventName: string;
    try {
      eventName = String(scValToNative(parsedTopics[0]) ?? "");
    } catch {
      return null;
    }
    if (eventName !== "withdraw") return null;

    const caller = String(scValToNative(parsedTopics[1]) ?? "");
    const receiver = String(scValToNative(parsedTopics[2]) ?? "");
    const owner = String(scValToNative(parsedTopics[3]) ?? "");

    const data = scValToNative(parsedValue as xdr.ScVal);
    const arr = Array.isArray(data) ? data : Object.values((data as Record<string, unknown>) ?? {});
    const assets = decodeBigInt(arr[0]);
    const shares = decodeBigInt(arr[1]);

    return { caller, receiver, owner, assets, shares };
  } catch {
    return null;
  }
}

export interface ParsedYieldDistributedEvent {
  epoch: number;
  amount: bigint;
  timestamp: bigint;
}

export function parseYieldDistributedEvent(rawEvent: unknown): ParsedYieldDistributedEvent | null {
  try {
    if (!rawEvent || typeof rawEvent !== "object") return null;
    const ev = rawEvent as Record<string, unknown>;
    const topics = (ev["topic"] ?? ev["topics"]) as unknown[] | undefined;
    const value = ev["value"] ?? ev["data"];

    if (!Array.isArray(topics) || topics.length < 2 || value == null) return null;

    const parsedTopics = topics.map((t) =>
      typeof t === "string" ? xdr.ScVal.fromXDR(t, "base64") : (t as xdr.ScVal),
    );
    const parsedValue = typeof value === "string"
      ? xdr.ScVal.fromXDR(value, "base64")
      : value;

    let eventName: string;
    try {
      eventName = String(scValToNative(parsedTopics[0]) ?? "");
    } catch {
      return null;
    }
    if (eventName !== "yield_dis") return null;

    const epoch = Number(scValToNative(parsedTopics[1]) ?? 0);

    const data = scValToNative(parsedValue as xdr.ScVal);
    const arr = Array.isArray(data) ? data : Object.values((data as Record<string, unknown>) ?? {});
    const amount = decodeBigInt(arr[0]);
    const timestamp = decodeBigInt(arr[1]);

    return { epoch, amount, timestamp };
  } catch {
    return null;
  }
}

export function parseVaultStateChangedEvent(rawEvent: any): {
  oldState: string;
  newState: string;
} | null {
  try {
    const parsed = parseRawEventName(rawEvent);
    if (!parsed) return null;

    const { topics, data } = parsed;
    let eventName = "";
    try {
      const firstTopic = typeof topics[0] === "string"
        ? xdr.ScVal.fromXDR(topics[0], "base64")
        : (topics[0] as any);
      eventName = scValToNative(firstTopic as any);
    } catch {
      return null;
    }

    if (eventName !== "st_chg" && eventName !== "vault_state_changed") return null;

    const parsedValue = typeof data === "string"
      ? xdr.ScVal.fromXDR(data, "base64")
      : data;
    const native = scValToNative(parsedValue as any) as any;
    const oldState = String(native?.oldState ?? (Array.isArray(native) ? native[0] : ""));
    const newState = String(native?.newState ?? (Array.isArray(native) ? native[1] : ""));

    return { oldState, newState };
  } catch {
    return null;
  }
}

export function parseVaultCreatedEvent(rawEvent: any): {
  contractId: string;
  asset: string;
  name: string;
  symbol: string;
} | null {
  try {
    const parsed = parseRawEventName(rawEvent);
    if (!parsed) return null;

    const { topics, data } = parsed;

    const parsedTopics = topics.map((t: any) =>
      typeof t === "string" ? xdr.ScVal.fromXDR(t, "base64") : t,
    );
    const parsedValue = typeof data === "string"
      ? xdr.ScVal.fromXDR(data, "base64")
      : data;

    let eventName = "";
    try {
      eventName = scValToNative(parsedTopics[0]);
    } catch {
      return null;
    }

    if (eventName !== "v_create" && eventName !== "vault_created") return null;

    const contractId = String(parsedTopics[1] ?? rawEvent?.contractId ?? "");
    const nativeData = scValToNative(parsedValue as any) as any;
    const asset = String(nativeData?.asset ?? (Array.isArray(nativeData) ? nativeData[0] : "") ?? "");
    const name = String(nativeData?.name ?? (Array.isArray(nativeData) ? nativeData[1] : "") ?? "");
    const symbol = String(nativeData?.symbol ?? (Array.isArray(nativeData) ? nativeData[2] : "") ?? "");

    return { contractId, asset, name, symbol };
  } catch (error) {
    logger.warn({ error }, "Error parsing vault_created event");
    return null;
  }
}

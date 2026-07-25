import type { Request, Response } from "express";
import { config } from "../config.js";

export interface VaultSseEvent {
  contractId: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface IndexerProgressSseEvent {
  lastLedger: number;
  eventsProcessed: number;
  tickDurationMs: number;
}

interface VaultClient {
  id: string;
  res: Response;
  contractIds?: Set<string>;
  heartbeatTimer: NodeJS.Timeout;
}

interface IndexerClient {
  id: string;
  res: Response;
  heartbeatTimer: NodeJS.Timeout;
}

export class SseManager {
  private activeConnections = 0;
  private vaultClients = new Map<string, VaultClient>();
  private indexerClients = new Map<string, IndexerClient>();
  private nextClientId = 1;

  /**
   * Get the current count of open SSE connections (#760).
   */
  getSseConnectionCount(): number {
    return this.activeConnections;
  }

  /**
   * Register a new client for vault event streams (#758, #759, #760).
   */
  addVaultClient(req: Request, res: Response, contractIds?: Set<string>): void {
    const clientId = `vault-${this.nextClientId++}`;

    // Set standard SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    // Increment server-side SSE connection counter (#760)
    this.activeConnections++;

    // Setup heartbeat interval (#759)
    const heartbeatTimer = setInterval(() => {
      res.write(": ping\n\n");
    }, config.sseHeartbeatMs);

    const client: VaultClient = {
      id: clientId,
      res,
      contractIds: contractIds && contractIds.size > 0 ? contractIds : undefined,
      heartbeatTimer,
    };

    this.vaultClients.set(clientId, client);

    // Clean up on disconnect (#760)
    const cleanup = () => {
      if (this.vaultClients.has(clientId)) {
        clearInterval(heartbeatTimer);
        this.vaultClients.delete(clientId);
        this.activeConnections = Math.max(0, this.activeConnections - 1);
      }
    };

    req.on?.("close", cleanup);
    res.on?.("close", cleanup);
  }

  /**
   * Register a new client for indexer progress streams (#757, #759, #760).
   */
  addIndexerClient(req: Request, res: Response): void {
    const clientId = `indexer-${this.nextClientId++}`;

    // Set standard SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    // Increment server-side SSE connection counter (#760)
    this.activeConnections++;

    // Setup heartbeat interval (#759)
    const heartbeatTimer = setInterval(() => {
      res.write(": ping\n\n");
    }, config.sseHeartbeatMs);

    const client: IndexerClient = {
      id: clientId,
      res,
      heartbeatTimer,
    };

    this.indexerClients.set(clientId, client);

    // Clean up on disconnect (#760)
    const cleanup = () => {
      if (this.indexerClients.has(clientId)) {
        clearInterval(heartbeatTimer);
        this.indexerClients.delete(clientId);
        this.activeConnections = Math.max(0, this.activeConnections - 1);
      }
    };

    req.on?.("close", cleanup);
    res.on?.("close", cleanup);
  }

  /**
   * Broadcast a vault event to matching SSE subscribers (#758).
   */
  broadcastVaultEvent(event: VaultSseEvent): void {
    const dataString = JSON.stringify({
      contractId: event.contractId,
      type: event.type,
      payload: event.payload,
    });
    const message = `data: ${dataString}\n\n`;

    for (const client of this.vaultClients.values()) {
      if (client.contractIds && !client.contractIds.has(event.contractId)) {
        continue; // Skip if client filtered by contractIds and event contractId is not in set
      }
      client.res.write(message);
    }
  }

  /**
   * Broadcast indexer tick progress event to subscribers (#757).
   */
  broadcastIndexerProgress(progress: IndexerProgressSseEvent): void {
    const dataString = JSON.stringify({
      lastLedger: progress.lastLedger,
      eventsProcessed: progress.eventsProcessed,
      tickDurationMs: progress.tickDurationMs,
    });
    const message = `data: ${dataString}\n\n`;

    for (const client of this.indexerClients.values()) {
      client.res.write(message);
    }
  }

  /**
   * Reset state (useful for tests).
   */
  reset(): void {
    for (const client of this.vaultClients.values()) {
      clearInterval(client.heartbeatTimer);
    }
    for (const client of this.indexerClients.values()) {
      clearInterval(client.heartbeatTimer);
    }
    this.vaultClients.clear();
    this.indexerClients.clear();
    this.activeConnections = 0;
  }
}

export const sseManager = new SseManager();
export default sseManager;

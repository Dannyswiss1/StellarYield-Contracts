import type { Vault, UserVaultPosition, PaginatedResponse } from "../types/index.js";
import { query } from "../db/index.js";
import { logger } from "../logger.js";
import { EventEmitter } from "events";

interface ListVaultsOptions {
  page: number;
  pageSize: number;
  state?: string;
  sort: "created_at" | "total_assets";
  order: "asc" | "desc";
}

interface VaultRow {
  id: number;
  contract_id: string;
  factory_id: string | null;
  asset: string;
  name: string | null;
  symbol: string | null;
  state: string;
  total_assets: string;
  total_supply: string;
  depositor_count: number;
  created_at: Date;
  updated_at: Date;
}

function mapVaultRow(row: VaultRow): Vault {
  return {
    id: row.id,
    contractId: row.contract_id,
    factoryId: row.factory_id,
    asset: row.asset,
    name: row.name,
    symbol: row.symbol,
    state: row.state as any,
    totalAssets: row.total_assets,
    totalSupply: row.total_supply,
    depositorCount: row.depositor_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class VaultService {
  private emitter = new EventEmitter();

  public onVaultUpdate(contractId: string, callback: (vault: Vault) => void): () => void {
    const listener = (data: { contractId: string; vault: Vault }) => {
      if (data.contractId === contractId) {
        callback(data.vault);
      }
    };
    this.emitter.on("vault:updated", listener);
    return () => this.emitter.off("vault:updated", listener);
  }

  async listVaults(opts: ListVaultsOptions): Promise<PaginatedResponse<Vault>> {
    const { page, pageSize, state, sort, order } = opts;
    const offset = (page - 1) * pageSize;
    const sortColumn = sort === "total_assets" ? "total_assets" : "created_at";
    const sortDirection = order === "asc" ? "ASC" : "DESC";

    // Build WHERE clause if state filter is provided
    const whereClause = state ? "WHERE v.state = $3" : "";
    const params: any[] = [pageSize, offset];
    if (state) params.push(state);

    // Query vaults with pagination
    const vaults = await query<VaultRow>(
      `SELECT v.id, v.contract_id, v.factory_id, v.asset, v.name, v.symbol, v.state,
              v.total_assets, v.total_supply, v.created_at, v.updated_at,
              COALESCE((
                SELECT COUNT(*)::int
                FROM user_vault_positions uvp
                WHERE uvp.vault_id = v.id AND uvp.shares > 0
              ), 0) AS depositor_count
       FROM vaults v
       ${whereClause}
       ORDER BY v.${sortColumn} ${sortDirection}
       LIMIT $1 OFFSET $2`,
      params,
    );

    // Get total count
    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM vaults v
       ${state ? "WHERE v.state = $1" : ""}`,
      state ? [state] : [],
    );
    const total = parseInt(countResult[0]?.count ?? "0", 10);

    // Map database rows to Vault type
    const data: Vault[] = vaults.map(mapVaultRow);

    return {
      data,
      total,
      page,
      pageSize,
    };
  }

  async countVaults(): Promise<number> {
    const countResult = await query<{ count: string }>(
      "SELECT COUNT(*) as count FROM vaults",
    );
    return parseInt(countResult[0]?.count ?? "0", 10);
  }

  async listVaultsByFactory(factoryId: string): Promise<Vault[]> {
    const rows = await query<VaultRow>(
      `SELECT v.id, v.contract_id, v.factory_id, v.asset, v.name, v.symbol, v.state,
              v.total_assets, v.total_supply, v.created_at, v.updated_at,
              COALESCE((
                SELECT COUNT(*)::int
                FROM user_vault_positions uvp
                WHERE uvp.vault_id = v.id AND uvp.shares > 0
              ), 0) AS depositor_count
       FROM vaults v
       WHERE v.factory_id = $1
       ORDER BY v.created_at DESC`,
      [factoryId],
    );

    return rows.map(mapVaultRow);
  }

  async getVault(contractId: string): Promise<Vault | null> {
    const rows = await query<VaultRow>(
      `SELECT v.id, v.contract_id, v.factory_id, v.asset, v.name, v.symbol, v.state,
              v.total_assets, v.total_supply, v.created_at, v.updated_at,
              COALESCE((
                SELECT COUNT(*)::int
                FROM user_vault_positions uvp
                WHERE uvp.vault_id = v.id AND uvp.shares > 0
              ), 0) AS depositor_count
       FROM vaults v
       WHERE v.contract_id = $1`,
      [contractId],
    );

    if (rows.length === 0) return null;

    return mapVaultRow(rows[0]);
  }

  async getVaultPositions(contractId: string): Promise<UserVaultPosition[]> {
    const rows = await query<{
      id: number;
      user_address: string;
      vault_id: number;
      shares: string;
      deposited: string;
      last_claimed_epoch: number;
      updated_at: Date;
    }>(
      `SELECT uvp.id, uvp.user_address, uvp.vault_id, uvp.shares, 
              uvp.deposited, uvp.last_claimed_epoch, uvp.updated_at
       FROM user_vault_positions uvp
       JOIN vaults v ON uvp.vault_id = v.id
       WHERE v.contract_id = $1
       ORDER BY uvp.shares DESC`,
      [contractId],
    );

    return rows.map((row) => ({
      id: row.id,
      userAddress: row.user_address,
      vaultId: row.vault_id,
      shares: row.shares,
      deposited: row.deposited,
      lastClaimedEpoch: row.last_claimed_epoch,
      updatedAt: row.updated_at,
    }));
  }

  async upsertVault(vault: Partial<Vault> & { contractId: string }): Promise<void> {
    const {
      contractId,
      factoryId = null,
      asset = "",
      name = null,
      symbol = null,
      state = "Funding",
      totalAssets = "0",
      totalSupply = "0",
    } = vault;

    logger.info(
      { contractId, factoryId, name, asset },
      "Upserting vault into database",
    );

    await query(
      `INSERT INTO vaults (contract_id, factory_id, asset, name, symbol, state, total_assets, total_supply, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       ON CONFLICT (contract_id)
       DO UPDATE SET
         state = EXCLUDED.state,
         total_assets = EXCLUDED.total_assets,
         total_supply = EXCLUDED.total_supply,
         updated_at = NOW()`,
      [contractId, factoryId, asset, name, symbol, state, totalAssets, totalSupply],
    );

    logger.info({ contractId }, "Vault upserted successfully");

    // Emit update event for SSE listeners
    const updatedVault = await this.getVault(contractId);
    if (updatedVault) {
      this.emitter.emit("vault:updated", { contractId, vault: updatedVault });
    }
  }
}

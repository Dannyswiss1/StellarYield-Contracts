import type {
  User,
  UserVaultPosition,
  UserPortfolioResponse,
} from "../types/index.js";
import { query } from "../db/index.js";
import { EventEmitter } from "events";

export class UserService {
  private emitter = new EventEmitter();

  public onPositionUpdate(
    address: string,
    callback: (position: { vaultContractId: string; shares: string; deposited: string }) => void
  ): () => void {
    const listener = (data: { address: string; vaultContractId: string; shares: string; deposited: string }) => {
      if (data.address === address) {
        callback({
          vaultContractId: data.vaultContractId,
          shares: data.shares,
          deposited: data.deposited,
        });
      }
    };
    this.emitter.on("position:updated", listener);
    return () => this.emitter.off("position:updated", listener);
  }

  public emitPositionUpdate(
    address: string,
    vaultContractId: string,
    shares: string,
    deposited: string
  ): void {
    this.emitter.emit("position:updated", { address, vaultContractId, shares, deposited });
  }

  async getUser(address: string): Promise<User | null> {
    const result = await query<{
      id: number;
      address: string;
      kyc_verified: boolean;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, address, kyc_verified, created_at, updated_at 
       FROM users 
       WHERE address = $1`,
      [address],
    );

    if (result.length === 0) {
      return null;
    }

    const row = result[0];
    return {
      id: row.id,
      address: row.address,
      kycVerified: row.kyc_verified,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async upsertUser(address: string, kycVerified?: boolean): Promise<void> {
    await query(
      `INSERT INTO users (address, kyc_verified) 
       VALUES ($1, $2)
       ON CONFLICT (address) DO UPDATE 
       SET kyc_verified = COALESCE($2, users.kyc_verified),
           updated_at = NOW()`,
      [address, kycVerified ?? false],
    );
  }

  async getUserPortfolio(address: string): Promise<UserPortfolioResponse> {
    const positions = await query<{
      id: number;
      user_address: string;
      vault_id: number;
      shares: string;
      deposited: string;
      last_claimed_epoch: number;
      updated_at: Date;
    }>(
      `SELECT id, user_address, vault_id, shares, deposited, last_claimed_epoch, updated_at
       FROM user_vault_positions
       WHERE user_address = $1`,
      [address],
    );

    let totalDeposited = "0";
    const transformedPositions: UserVaultPosition[] = positions.map((row) => {
      const deposited = row.deposited || "0";
      totalDeposited = (BigInt(totalDeposited) + BigInt(deposited)).toString();

      return {
        id: row.id,
        userAddress: row.user_address,
        vaultId: row.vault_id,
        shares: row.shares || "0",
        deposited,
        lastClaimedEpoch: row.last_claimed_epoch,
        updatedAt: row.updated_at,
      };
    });

    return {
      positions: transformedPositions,
      totalDeposited,
    };
  }

  async searchUsers(search: string): Promise<User[]> {
    const result = await query<{
      id: number;
      address: string;
      kyc_verified: boolean;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, address, kyc_verified, created_at, updated_at 
       FROM users 
       WHERE address ILIKE $1 
       LIMIT 20`,
      [`%${search}%`],
    );

    return result.map((row) => ({
      id: row.id,
      address: row.address,
      kycVerified: row.kyc_verified,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async countUsers(): Promise<number> {
    const result = await query<{ count: string }>("SELECT COUNT(*) as count FROM users");
    return parseInt(result[0]?.count ?? "0", 10);
  }
}

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VaultService } from "./vault.js";
import * as db from "../db/index.js";

vi.mock("../db/index.js");
vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const CONTRACT_ID = "CDLZFC3SYJYHZDQA6M57EYUC2XBDA6LQF3M6KFRDZ7TXJYJL2K3B";

describe("VaultService", () => {
  let vaultService: VaultService;

  beforeEach(() => {
    vaultService = new VaultService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getEarlyRedemptionFeePreview", () => {
    it("computes gross, fee, and net for a 1:1 exchange rate", async () => {
      vi.mocked(db.query).mockResolvedValueOnce([
        { total_assets: "1000", total_supply: "1000", early_redemption_fee_bps: 250 },
      ]);

      const preview = await vaultService.getEarlyRedemptionFeePreview(
        CONTRACT_ID,
        1000n,
      );

      // grossAssets = 1000, feeBps = 250 (2.5%)
      // netAssets = 1000 * (10000 - 250) / 10000 = 975
      expect(preview).toEqual({
        grossAssets: "1000",
        feeBps: 250,
        feeAmount: "25",
        netAssets: "975",
      });
    });

    it("converts shares to assets at the current exchange rate", async () => {
      vi.mocked(db.query).mockResolvedValueOnce([
        { total_assets: "2000", total_supply: "1000", early_redemption_fee_bps: 0 },
      ]);

      const preview = await vaultService.getEarlyRedemptionFeePreview(
        CONTRACT_ID,
        500n,
      );

      // grossAssets = 500 * 2000 / 1000 = 1000, no fee
      expect(preview).toEqual({
        grossAssets: "1000",
        feeBps: 0,
        feeAmount: "0",
        netAssets: "1000",
      });
    });

    it("falls back to a 1:1 rate when no shares are minted", async () => {
      vi.mocked(db.query).mockResolvedValueOnce([
        { total_assets: "0", total_supply: "0", early_redemption_fee_bps: 100 },
      ]);

      const preview = await vaultService.getEarlyRedemptionFeePreview(
        CONTRACT_ID,
        1000n,
      );

      expect(preview).toEqual({
        grossAssets: "1000",
        feeBps: 100,
        feeAmount: "10",
        netAssets: "990",
      });
    });

    it("returns null for an unknown vault", async () => {
      vi.mocked(db.query).mockResolvedValueOnce([]);

      const preview = await vaultService.getEarlyRedemptionFeePreview(
        CONTRACT_ID,
        1000n,
      );

      expect(preview).toBeNull();
    });
  });

  describe("getVaultExportData", () => {
    it("returns export fields including epoch count", async () => {
      const maturity = new Date("2025-12-31T00:00:00.000Z");
      vi.mocked(db.query).mockResolvedValueOnce([
        {
          contract_id: CONTRACT_ID,
          state: "Active",
          total_assets: "1000",
          total_supply: "900",
          expected_apy: 500,
          maturity_date: maturity,
          depositor_count: 3,
          epoch_count: 4,
        },
      ]);

      const data = await vaultService.getVaultExportData(CONTRACT_ID);

      expect(data).toEqual({
        contractId: CONTRACT_ID,
        state: "Active",
        totalAssets: "1000",
        totalSupply: "900",
        depositorCount: 3,
        epochCount: 4,
        expectedApy: 500,
        maturityDate: maturity,
      });
    });

    it("returns null for an unknown vault", async () => {
      vi.mocked(db.query).mockResolvedValueOnce([]);

      const data = await vaultService.getVaultExportData(CONTRACT_ID);

      expect(data).toBeNull();
    });
  });

  describe("listVaultHolders", () => {
    it("returns active holders with full active-holder total", async () => {
      const updatedAt = new Date("2025-01-01T00:00:00.000Z");
      vi.mocked(db.query)
        .mockResolvedValueOnce([{ id: 42 }])
        .mockResolvedValueOnce([
          {
            user_address: "GUSER1",
            shares: "300",
            deposited: "250",
            updated_at: updatedAt,
          },
        ])
        .mockResolvedValueOnce([{ count: "5" }]);

      const result = await vaultService.listVaultHolders(CONTRACT_ID, {
        page: 2,
        pageSize: 2,
        sort: "shares",
      });

      expect(result).toEqual({
        data: [
          {
            userAddress: "GUSER1",
            shares: "300",
            deposited: "250",
            lastUpdatedAt: updatedAt,
          },
        ],
        total: 5,
        page: 2,
        pageSize: 2,
      });
      expect(db.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("WHERE vault_id = $1 AND shares > 0"),
        [42, 2, 2],
      );
      expect(db.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("ORDER BY shares DESC"),
        [42, 2, 2],
      );
    });

    it("supports sorting active holders by deposited amount", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce([{ id: 42 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: "0" }]);

      await vaultService.listVaultHolders(CONTRACT_ID, {
        page: 1,
        pageSize: 200,
        sort: "deposited",
      });

      expect(db.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("ORDER BY deposited DESC"),
        [42, 100, 0],
      );
    });

    it("returns null for an unknown vault", async () => {
      vi.mocked(db.query).mockResolvedValueOnce([]);

      const result = await vaultService.listVaultHolders(CONTRACT_ID, {
        page: 1,
        pageSize: 20,
        sort: "shares",
      });

      expect(result).toBeNull();
    });
  });

  describe("countVaultHolders", () => {
    it("counts only holders with shares greater than zero", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce([{ id: 42 }])
        .mockResolvedValueOnce([{ count: "3" }]);

      const count = await vaultService.countVaultHolders(CONTRACT_ID);

      expect(count).toBe(3);
      expect(db.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("WHERE vault_id = $1 AND shares > 0"),
        [42],
      );
    });

    it("returns null when the vault does not exist", async () => {
      vi.mocked(db.query).mockResolvedValueOnce([]);

      await expect(vaultService.countVaultHolders(CONTRACT_ID)).resolves.toBeNull();
    });
  });

  describe("getVaultHoldersForExport", () => {
    it("returns every active holder sorted by largest share balance", async () => {
      const updatedAt = new Date("2025-01-01T00:00:00.000Z");
      vi.mocked(db.query)
        .mockResolvedValueOnce([{ id: 42 }])
        .mockResolvedValueOnce([
          {
            user_address: "GUSER1",
            shares: "300",
            deposited: "250",
            updated_at: updatedAt,
          },
        ]);

      const holders = await vaultService.getVaultHoldersForExport(CONTRACT_ID);

      expect(holders).toEqual([
        {
          userAddress: "GUSER1",
          shares: "300",
          deposited: "250",
          lastUpdatedAt: updatedAt,
        },
      ]);
      expect(db.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("ORDER BY shares DESC"),
        [42],
      );
      expect(db.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("WHERE vault_id = $1 AND shares > 0"),
        [42],
      );
    });
  });
});

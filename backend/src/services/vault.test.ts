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

  describe("getMaturitySoonVaults", () => {
    it("returns active vaults maturing within the given days with daysUntilMaturity", async () => {
      const createdAt = new Date("2025-01-01T00:00:00.000Z");
      const maturityDate = new Date("2025-12-31T00:00:00.000Z");
      vi.mocked(db.query).mockResolvedValueOnce([
        {
          id: 1,
          contract_id: CONTRACT_ID,
          factory_id: null,
          asset: "USDC",
          name: "Real Estate Fund",
          symbol: "REF",
          state: "Active",
          total_assets: "5000",
          total_supply: "4500",
          total_shares_ever_minted: "4500",
          total_shares_ever_burned: "0",
          depositor_count: 10,
          funding_target: "4000",
          funding_deadline: null,
          min_deposit: null,
          max_deposit_per_user: null,
          rwa_name: null,
          rwa_symbol: null,
          rwa_document_uri: null,
          rwa_category: "real-estate",
          created_at: createdAt,
          updated_at: createdAt,
          days_until_maturity: 14,
        },
      ]);

      const result = await vaultService.getMaturitySoonVaults(30);

      expect(result).toHaveLength(1);
      expect(result[0].contractId).toBe(CONTRACT_ID);
      expect(result[0].daysUntilMaturity).toBe(14);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("v.state = 'Active'"),
        [30],
      );
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("days_until_maturity"),
        [30],
      );
    });

    it("returns empty array when no vaults are maturing soon", async () => {
      vi.mocked(db.query).mockResolvedValueOnce([]);

      const result = await vaultService.getMaturitySoonVaults(7);

      expect(result).toEqual([]);
    });
  });

  describe("getFullyFundedVaults", () => {
    it("returns Funding-state vaults at or above their funding target", async () => {
      const createdAt = new Date("2025-01-01T00:00:00.000Z");
      vi.mocked(db.query).mockResolvedValueOnce([
        {
          id: 2,
          contract_id: CONTRACT_ID,
          factory_id: null,
          asset: "USDC",
          name: "Bond Fund",
          symbol: "BF",
          state: "Funding",
          total_assets: "10500",
          total_supply: "10000",
          total_shares_ever_minted: "10000",
          total_shares_ever_burned: "0",
          depositor_count: 5,
          funding_target: "10000",
          funding_deadline: null,
          min_deposit: null,
          max_deposit_per_user: null,
          rwa_name: null,
          rwa_symbol: null,
          rwa_document_uri: null,
          rwa_category: "bonds",
          created_at: createdAt,
          updated_at: createdAt,
        },
      ]);

      const result = await vaultService.getFullyFundedVaults();

      expect(result).toHaveLength(1);
      expect(result[0].state).toBe("Funding");
      expect(result[0].fundingProgress).toBe(100);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("v.state = 'Funding'"),
      );
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("v.total_assets::numeric >= v.funding_target::numeric"),
      );
    });

    it("returns empty array when no fully-funded vaults exist", async () => {
      vi.mocked(db.query).mockResolvedValueOnce([]);

      const result = await vaultService.getFullyFundedVaults();

      expect(result).toEqual([]);
    });
  });

  describe("searchVaults with fuzzy", () => {
    it("uses similarity() when fuzzy=true", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: "0" }]);

      await vaultService.searchVaults({
        q: "realestat",
        page: 1,
        pageSize: 20,
        sort: "created_at",
        order: "desc",
        fuzzy: true,
      });

      expect(db.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("similarity(v.name, $1) > 0.3"),
        expect.arrayContaining(["realestat"]),
      );
    });

    it("uses ILIKE when fuzzy=false", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: "0" }]);

      await vaultService.searchVaults({
        q: "real estate",
        page: 1,
        pageSize: 20,
        sort: "created_at",
        order: "desc",
        fuzzy: false,
      });

      expect(db.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("ILIKE"),
        expect.arrayContaining(["%real estate%"]),
      );
    });

    it("filters by rwa_category when category is provided", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: "0" }]);

      await vaultService.searchVaults({
        category: "real-estate",
        page: 1,
        pageSize: 20,
        sort: "created_at",
        order: "desc",
      });

      expect(db.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("v.rwa_category = $1"),
        expect.arrayContaining(["real-estate"]),
      );
    });
  });

  describe("getSimilarVaults", () => {
    it("returns similar active vaults in the same category sorted by TVL proximity", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce([{ rwa_category: "real-estate", total_assets: "5000" }])
        .mockResolvedValueOnce([
          { contract_id: "CDLZFC3SYJYHZDQA6M57EYUC2XBDA6LQF3M6KFRDZ7TXJYJL2K3C", name: "RE Fund 2", total_assets: "5500", rwa_category: "real-estate" },
        ]);

      const result = await vaultService.getSimilarVaults(CONTRACT_ID);

      expect(result).toHaveLength(1);
      expect(result![0].contractId).toBe("CDLZFC3SYJYHZDQA6M57EYUC2XBDA6LQF3M6KFRDZ7TXJYJL2K3C");
      expect(result![0].rwaCategory).toBe("real-estate");
      expect(db.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("ABS(total_assets::numeric - $3::numeric) ASC"),
        ["real-estate", CONTRACT_ID, "5000"],
      );
      expect(db.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("LIMIT 5"),
        expect.any(Array),
      );
    });

    it("returns null when the target vault does not exist", async () => {
      vi.mocked(db.query).mockResolvedValueOnce([]);

      const result = await vaultService.getSimilarVaults(CONTRACT_ID);

      expect(result).toBeNull();
    });

    it("returns empty array when the target vault has no rwa_category", async () => {
      vi.mocked(db.query).mockResolvedValueOnce([{ rwa_category: null, total_assets: "5000" }]);

      const result = await vaultService.getSimilarVaults(CONTRACT_ID);

      expect(result).toEqual([]);
    });

    it("returns empty array when no similar vaults exist", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce([{ rwa_category: "rare-category", total_assets: "1000" }])
        .mockResolvedValueOnce([]);

      const result = await vaultService.getSimilarVaults(CONTRACT_ID);

      expect(result).toEqual([]);
    });
  });
});

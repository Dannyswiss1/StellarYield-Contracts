import { describe, it, expect, beforeEach, vi } from "vitest";
import { VaultService } from "./vault.js";
import * as db from "../db/index.js";

vi.mock("../db/index.js");
vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("../cache/redis.js", () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  cacheDel: vi.fn().mockResolvedValue(undefined),
}));

const CONTRACT_ID = "CDLZFC3SYJYHZDQA6M57EYUC2XBDA6LQF3M6KFRDZ7TXJYJL2K3B";

describe("VaultService soft-delete (#674)", () => {
  let vaultService: VaultService;

  beforeEach(() => {
    vaultService = new VaultService();
    vi.clearAllMocks();
  });

  describe("listVaults", () => {
    it("excludes archived vaults from standard list", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce([]) // vaults query
        .mockResolvedValueOnce([{ count: "0" }]); // count query

      await vaultService.listVaults({
        page: 1,
        pageSize: 20,
        sort: "created_at",
        order: "desc",
      });

      const call = vi.mocked(db.query).mock.calls[0];
      expect(call[0]).toContain("v.archived = FALSE");
    });

    it("returns all active vaults", async () => {
      const createdAt = new Date();
      vi.mocked(db.query)
        .mockResolvedValueOnce([
          {
            id: 1,
            contract_id: CONTRACT_ID,
            factory_id: null,
            asset: "USDC",
            name: "Vault A",
            symbol: "VA",
            state: "Active",
            total_assets: "1000",
            total_supply: "1000",
            total_shares_ever_minted: "1000",
            total_shares_ever_burned: "0",
            depositor_count: 5,
            funding_target: null,
            funding_deadline: null,
            min_deposit: null,
            max_deposit_per_user: null,
            zkme_verifier_address: null,
            rwa_name: null,
            rwa_symbol: null,
            rwa_document_uri: null,
            rwa_category: null,
            created_at: createdAt,
            updated_at: createdAt,
          },
        ])
        .mockResolvedValueOnce([{ count: "1" }]);

      const result = await vaultService.listVaults({
        page: 1,
        pageSize: 20,
        sort: "created_at",
        order: "desc",
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].contractId).toBe(CONTRACT_ID);
    });
  });

  describe("getVault", () => {
    it("returns archived vault by contractId", async () => {
      const createdAt = new Date();
      vi.mocked(db.query).mockResolvedValueOnce([
        {
          id: 1,
          contract_id: CONTRACT_ID,
          factory_id: null,
          asset: "USDC",
          name: "Archived Vault",
          symbol: "AV",
          state: "Cancelled",
          total_assets: "500",
          total_supply: "500",
          total_shares_ever_minted: "500",
          total_shares_ever_burned: "0",
          depositor_count: 2,
          funding_target: null,
          funding_deadline: null,
          min_deposit: null,
          max_deposit_per_user: null,
          zkme_verifier_address: null,
          rwa_name: null,
          rwa_symbol: null,
          rwa_document_uri: null,
          rwa_category: null,
          created_at: createdAt,
          updated_at: createdAt,
        },
      ]);

      const vault = await vaultService.getVault(CONTRACT_ID);

      expect(vault).not.toBeNull();
      expect(vault?.contractId).toBe(CONTRACT_ID);
      // Verify query does NOT filter on archived
      const call = vi.mocked(db.query).mock.calls[0];
      expect(call[0]).not.toContain("archived");
    });
  });

  describe("countVaults", () => {
    it("counts only non-archived vaults", async () => {
      vi.mocked(db.query).mockResolvedValueOnce([{ count: "10" }]);

      const count = await vaultService.countVaults();

      expect(count).toBe(10);
      const call = vi.mocked(db.query).mock.calls[0];
      expect(call[0]).toContain("WHERE archived = FALSE");
    });
  });

  describe("listArchivedVaults", () => {
    it("returns only archived vaults ordered by updated_at DESC", async () => {
      const updatedAt1 = new Date("2025-01-02");
      const updatedAt2 = new Date("2025-01-01");
      vi.mocked(db.query).mockResolvedValueOnce([
        {
          id: 1,
          contract_id: "VAULT1",
          factory_id: null,
          asset: "USDC",
          name: "Archived First",
          symbol: "AF",
          state: "Cancelled",
          total_assets: "100",
          total_supply: "100",
          total_shares_ever_minted: "100",
          total_shares_ever_burned: "0",
          depositor_count: 1,
          funding_target: null,
          funding_deadline: null,
          min_deposit: null,
          max_deposit_per_user: null,
          zkme_verifier_address: null,
          rwa_name: null,
          rwa_symbol: null,
          rwa_document_uri: null,
          rwa_category: null,
          created_at: updatedAt1,
          updated_at: updatedAt1,
        },
        {
          id: 2,
          contract_id: "VAULT2",
          factory_id: null,
          asset: "USDC",
          name: "Archived Second",
          symbol: "AS",
          state: "Cancelled",
          total_assets: "200",
          total_supply: "200",
          total_shares_ever_minted: "200",
          total_shares_ever_burned: "0",
          depositor_count: 2,
          funding_target: null,
          funding_deadline: null,
          min_deposit: null,
          max_deposit_per_user: null,
          zkme_verifier_address: null,
          rwa_name: null,
          rwa_symbol: null,
          rwa_document_uri: null,
          rwa_category: null,
          created_at: updatedAt2,
          updated_at: updatedAt2,
        },
      ]);

      const vaults = await vaultService.listArchivedVaults();

      expect(vaults).toHaveLength(2);
      expect(vaults[0].contractId).toBe("VAULT1");
      const call = vi.mocked(db.query).mock.calls[0];
      expect(call[0]).toContain("WHERE v.archived = TRUE");
      expect(call[0]).toContain("ORDER BY v.updated_at DESC");
    });
  });

  describe("searchVaults", () => {
    it("excludes archived vaults from search", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: "0" }]);

      await vaultService.searchVaults({
        q: "test",
        page: 1,
        pageSize: 20,
        sort: "created_at",
        order: "desc",
      });

      const call = vi.mocked(db.query).mock.calls[0];
      expect(call[0]).toContain("v.archived = FALSE");
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db/index.js", () => ({ query: vi.fn() }));

async function getTestContext() {
  const { query } = await import("../../db/index.js");
  const { getVaultEpochs, getUserPendingYield } = await import("./yields.js");
  return {
    query: query as ReturnType<typeof vi.fn>,
    getVaultEpochs,
    getUserPendingYield,
  };
}

describe("Yield Controllers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getVaultEpochs", () => {
    it("returns 200 with an array of epochs", async () => {
      const { query, getVaultEpochs } = await getTestContext();
      query.mockResolvedValue([
        {
          id: 1,
          vault_id: 10,
          epoch: 1,
          yield_amount: "500",
          total_shares: "5000",
          distributed_at: new Date("2025-01-01"),
        },
      ]);

      const req = { params: { contractId: "CC_VAULT" } } as any;
      const res = { json: vi.fn() } as any;
      const next = vi.fn();

      await getVaultEpochs(req, res, next);

      expect(res.json).toHaveBeenCalledOnce();
      const body = res.json.mock.calls[0][0];
      expect(Array.isArray(body)).toBe(true);
      expect(body[0].epoch).toBe(1);
      expect(body[0].yieldAmount).toBe("500");
    });

    it("returns empty array when vault has no epochs", async () => {
      const { query, getVaultEpochs } = await getTestContext();
      query.mockResolvedValue([]);

      const req = { params: { contractId: "CC_EMPTY" } } as any;
      const res = { json: vi.fn() } as any;
      const next = vi.fn();

      await getVaultEpochs(req, res, next);

      expect(res.json).toHaveBeenCalledWith([]);
    });
  });

  describe("getUserPendingYield", () => {
    it("returns response with pendingYield string", async () => {
      const { query, getUserPendingYield } = await getTestContext();
      query
        .mockResolvedValueOnce([{ shares: "1000", last_claimed_epoch: -1 }])
        .mockResolvedValueOnce([
          { epoch: 1, yield_amount: "500", total_shares: "5000" },
        ]);

      const req = {
        params: { contractId: "CC_VAULT", userAddress: "GADDR123" },
      } as any;
      const res = { json: vi.fn() } as any;
      const next = vi.fn();

      await getUserPendingYield(req, res, next);

      expect(res.json).toHaveBeenCalledOnce();
      const body = res.json.mock.calls[0][0];
      expect(typeof body.pendingYield).toBe("string");
      expect(body.pendingYield).toBe("100");
      expect(Array.isArray(body.epochs)).toBe(true);
    });

    it("returns pendingYield of 0 when user has no position", async () => {
      const { query, getUserPendingYield } = await getTestContext();
      query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const req = {
        params: { contractId: "CC_VAULT", userAddress: "GNEW" },
      } as any;
      const res = { json: vi.fn() } as any;
      const next = vi.fn();

      await getUserPendingYield(req, res, next);

      const body = res.json.mock.calls[0][0];
      expect(body.pendingYield).toBe("0");
    });
  });
});

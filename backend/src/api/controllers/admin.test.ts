import { describe, it, expect, vi, beforeEach } from "vitest";
import supertest from "supertest";
import { createHash } from "crypto";

vi.mock("../../db/index.js", () => ({ query: vi.fn() }));
vi.mock("../../services/indexerSingleton.js", () => ({
  indexer: {
    isRunning: vi.fn().mockReturnValue(false),
    getLastIndexedLedger: vi.fn().mockResolvedValue(0),
    getLastTickAt: vi.fn().mockReturnValue(null),
    getEventsIndexedCount: vi.fn().mockResolvedValue(0),
    queueBackfill: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../../services/jobQueue.js", () => ({
  jobQueue: {
    getJob: vi.fn(),
    getFailedJobs: vi.fn(),
  },
}));
vi.mock("../../services/vault.js", () => ({
  VaultService: vi.fn().mockImplementation(() => ({
    listArchivedVaults: vi.fn().mockResolvedValue([]),
    getVault: vi.fn().mockResolvedValue(null),
  })),
}));
vi.mock("../../services/stellar.js", () => ({
  readTotalSupply: vi.fn().mockResolvedValue(0n),
}));
vi.mock("pino-http", () => ({ pinoHttp: () => (_req: any, _res: any, next: any) => next() }));

async function getTestContext() {
  const { query } = await import("../../db/index.js");
  const { getAdminStats } = await import("./admin.js");
  return { query: query as ReturnType<typeof vi.fn>, getAdminStats };
}

async function getApp() {
  const { createApp } = await import("../../app.js");
  return createApp();
}

/** Hash an API key the same way the auth middleware does */
function _hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

describe("Admin Controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns per-vault fee metrics ordered by total fees and applies date filters", async () => {
    const { query } = await import("../../db/index.js");
    const { getAdminFeesDashboard } = await import("./admin.js");
    const mockQuery = query as ReturnType<typeof vi.fn>;

    mockQuery.mockResolvedValueOnce([
      {
        contract_id: "C1",
        name: "Alpha Vault",
        total_operator_fees: "2200",
        epoch_count: "4",
        fee_bps: 120,
        last_epoch_fee: "200",
      },
      {
        contract_id: "C2",
        name: "Beta Vault",
        total_operator_fees: "1500",
        epoch_count: "2",
        fee_bps: 80,
        last_epoch_fee: "100",
      },
    ]);

    const req = { query: { from: "2025-01-01", to: "2025-01-31" } } as any;
    const res = { json: vi.fn() } as any;
    const next = vi.fn();

    await getAdminFeesDashboard(req, res, next);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("ORDER BY"),
      expect.arrayContaining([expect.any(String), expect.any(String)]),
    );
    expect(res.json).toHaveBeenCalledWith([
      {
        contractId: "C1",
        name: "Alpha Vault",
        totalOperatorFees: "2200",
        epochCount: 4,
        feeBps: 120,
        lastEpochFee: "200",
      },
      {
        contractId: "C2",
        name: "Beta Vault",
        totalOperatorFees: "1500",
        epochCount: 2,
        feeBps: 80,
        lastEpochFee: "100",
      },
    ]);
  });

  it("deletes a user and returns a redaction receipt", async () => {
    const { query } = await import("../../db/index.js");
    const { deleteUser } = await import("./admin.js");
    const mockQuery = query as ReturnType<typeof vi.fn>;

    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("SELECT id FROM users")) {
        return Promise.resolve([{ id: 1 }]);
      }
      if (sql.includes("UPDATE user_vault_positions")) {
        return Promise.resolve([{ id: 10 }]);
      }
      if (sql.includes("UPDATE share_balance_snapshots")) {
        return Promise.resolve([{ id: 20 }, { id: 21 }]);
      }
      if (sql.includes("UPDATE redemption_requests")) {
        return Promise.resolve([]);
      }
      if (sql.includes("UPDATE indexed_events")) {
        return Promise.resolve([]);
      }
      if (sql.includes("DELETE FROM users")) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    const req = { params: { address: "GABCDEF" }, headers: {}, body: undefined } as any;
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;
    const next = vi.fn();

    await deleteUser(req, res, next);

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM users"), ["GABCDEF"]);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE indexed_events SET payload = jsonb_set(payload, '{user}'"),
      ["GABCDEF"],
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE indexed_events SET payload = jsonb_set(payload, '{address}'"),
      ["GABCDEF"],
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      address: "GABCDEF",
      deletedAt: expect.any(String),
      recordsAffected: 3,
    }));
  });

  it("returns paginated audit log entries ordered by creation time", async () => {
    const { query } = await import("../../db/index.js");
    const { getAdminAuditLog } = await import("./admin.js");
    const mockQuery = query as ReturnType<typeof vi.fn>;

    mockQuery.mockResolvedValueOnce([{ count: "1" }]);
    mockQuery.mockResolvedValueOnce([
      {
        id: 1,
        api_key_label: "ops",
        action: "delete_api_key",
        target: "/api/v1/admin/api-keys/1",
        ip_address: "203.0.113.10",
        request_body_hash: "abc123",
        created_at: new Date("2025-01-01T00:00:00.000Z"),
      },
    ]);

    const req = { query: { page: "1", pageSize: "20" } } as any;
    const res = { json: vi.fn() } as any;
    const next = vi.fn();

    await getAdminAuditLog(req, res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.any(Array),
      total: 1,
      page: 1,
      pageSize: 20,
    }));
  });

  // ── Unit tests (controller function directly) ─────────────────────────────
  describe("getAdminStats", () => {
    it("returns vault/user/epoch counts and TVL", async () => {
      const { query, getAdminStats } = await getTestContext();
      // vaultCount
      query.mockResolvedValueOnce([{ count: "2" }]);
      // userCount
      query.mockResolvedValueOnce([{ count: "42" }]);
      // totalValueLocked
      query.mockResolvedValueOnce([{ total: "12345" }]);
      // epochCount
      query.mockResolvedValueOnce([{ count: "3" }]);

      const req = {} as any;
      const res = { json: vi.fn() } as any;
      const next = vi.fn();

      await getAdminStats(req, res, next);

      expect(res.json).toHaveBeenCalledWith({ vaultCount: 2, userCount: 42, totalValueLocked: "12345", epochCount: 3 });
    });
  });

  // ── Integration tests: GET /api/v1/admin/stats (Issue #692) ──────────────
  describe("GET /api/v1/admin/stats", () => {
    const VALID_KEY = "test-admin-api-key-12345";

    beforeEach(async () => {
      const { query } = await import("../../db/index.js");
      const mockQuery = query as ReturnType<typeof vi.fn>;
      mockQuery.mockReset();
    });

    it("returns 401 when the Authorization header is missing", async () => {
      const app = await getApp();
      const res = await supertest(app).get("/api/v1/admin/stats");
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ error: "Unauthorized" });
    });

    it("returns 403 when the API key is invalid", async () => {
      const { query } = await import("../../db/index.js");
      const mockQuery = query as ReturnType<typeof vi.fn>;
      // auth middleware queries api_keys — return empty = key not found
      mockQuery.mockResolvedValue([]);

      const app = await getApp();
      const res = await supertest(app)
        .get("/api/v1/admin/stats")
        .set("Authorization", "Bearer not-a-real-key");

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: "Forbidden" });
    });

    it("returns 200 with correct vaultCount and userCount for a valid admin key and seeded DB", async () => {
      const { query } = await import("../../db/index.js");
      const mockQuery = query as ReturnType<typeof vi.fn>;

      // auth middleware: api_keys lookup → match the hashed key
      mockQuery.mockResolvedValueOnce([{ id: 1, role: "admin", label: "test" }]);
      // getAdminStats: vaultCount
      mockQuery.mockResolvedValueOnce([{ count: "3" }]);
      // getAdminStats: userCount
      mockQuery.mockResolvedValueOnce([{ count: "7" }]);
      // getAdminStats: totalValueLocked
      mockQuery.mockResolvedValueOnce([{ total: "9999999" }]);
      // getAdminStats: epochCount
      mockQuery.mockResolvedValueOnce([{ count: "5" }]);

      const app = await getApp();
      const res = await supertest(app)
        .get("/api/v1/admin/stats")
        .set("Authorization", `Bearer ${VALID_KEY}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        vaultCount: 3,
        userCount: 7,
        totalValueLocked: "9999999",
        epochCount: 5,
      });
    });
  });

  // ── Job status endpoint (#848) ─────────────────────────────────────────
  describe("getJobStatus", () => {
    it("returns 404 when job is not found", async () => {
      const { jobQueue } = await import("../../services/jobQueue.js");
      const { getJobStatus } = await import("./admin.js");
      (jobQueue.getJob as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const req = { params: { jobId: "nonexistent" } } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();

      await getJobStatus(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: "NotFound", message: "Job not found" });
    });

    it("returns job details when found", async () => {
      const { jobQueue } = await import("../../services/jobQueue.js");
      const { getJobStatus } = await import("./admin.js");
      (jobQueue.getJob as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "abc-123",
        name: "webhook-deliver",
        state: "completed",
        createdOn: new Date("2025-01-01"),
        completedOn: new Date("2025-01-01"),
        output: { success: true },
      });

      const req = { params: { jobId: "abc-123" } } as any;
      const res = { json: vi.fn() } as any;
      const next = vi.fn();

      await getJobStatus(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        id: "abc-123",
        name: "webhook-deliver",
        state: "completed",
        createdAt: new Date("2025-01-01"),
        completedOn: new Date("2025-01-01"),
        output: { success: true },
      });
    });
  });

  // ── Dead letter queue endpoint (#850) ──────────────────────────────────
  describe("getFailedJobs", () => {
    it("returns list of failed jobs", async () => {
      const { jobQueue } = await import("../../services/jobQueue.js");
      const { getFailedJobs } = await import("./admin.js");
      (jobQueue.getFailedJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: "fail-1",
          name: "webhook-deliver",
          data: { webhookId: 1 },
          state: "failed",
          createdOn: new Date("2025-01-01"),
          completedOn: new Date("2025-01-01"),
          output: { error: "timeout" },
        },
      ]);

      const req = {} as any;
      const res = { json: vi.fn() } as any;
      const next = vi.fn();

      await getFailedJobs(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        data: [
          {
            id: "fail-1",
            name: "webhook-deliver",
            payload: { webhookId: 1 },
            createdAt: new Date("2025-01-01"),
            completedAt: new Date("2025-01-01"),
            output: { error: "timeout" },
          },
        ],
      });
    });

    it("returns empty array when no failed jobs exist", async () => {
      const { jobQueue } = await import("../../services/jobQueue.js");
      const { getFailedJobs } = await import("./admin.js");
      (jobQueue.getFailedJobs as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const req = {} as any;
      const res = { json: vi.fn() } as any;
      const next = vi.fn();

      await getFailedJobs(req, res, next);

      expect(res.json).toHaveBeenCalledWith({ data: [] });
    });
  });
});

import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../db/index.js", () => ({ query: vi.fn() }));
vi.mock("../../config.js", () => ({
  config: { stellar: { vaultFactoryContractId: "CFACTORY000000000000000000000000000000000000000000000" } },
}));

import {
  getFactoryAdminHistory,
  getVaultCreationRate,
  getFactoryDefaults,
  getFactoryEvents,
  getFactoryInfo,
  getVaultCount,
} from "./factory.js";
import { config } from "../../config.js";

function makeRes() {
  return {
    json: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
  };
}

describe("getFactoryAdminHistory (#839)", () => {
  const next = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns admin transfer history ordered reverse-chronologically", async () => {
    const { query } = await import("../../db/index.js");
    (query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { old_admin: "GOLD", new_admin: "GNEW", ledger: 200, recorded_at: new Date("2026-01-02") },
      { old_admin: "GOLDER", new_admin: "GOLD", ledger: 100, recorded_at: new Date("2026-01-01") },
    ]);

    const res = makeRes();
    await getFactoryAdminHistory({} as any, res as any, next);

    expect(res.json).toHaveBeenCalledWith([
      { oldAdmin: "GOLD", newAdmin: "GNEW", ledger: 200, recordedAt: new Date("2026-01-02") },
      { oldAdmin: "GOLDER", newAdmin: "GOLD", ledger: 100, recordedAt: new Date("2026-01-01") },
    ]);
  });

  it("returns an empty array when no transfers have occurred", async () => {
    const { query } = await import("../../db/index.js");
    (query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const res = makeRes();
    await getFactoryAdminHistory({} as any, res as any, next);

    expect(res.json).toHaveBeenCalledWith([]);
  });
});

describe("getVaultCreationRate (#840)", () => {
  const next = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns counts for each rolling window", async () => {
    const { query } = await import("../../db/index.js");
    (query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { last24h: "2", last7d: "5", last30d: "12" },
    ]);

    const res = makeRes();
    await getVaultCreationRate({} as any, res as any, next);

    expect(res.json).toHaveBeenCalledWith({ last24h: 2, last7d: 5, last30d: 12 });
  });
});

describe("getFactoryDefaults (#841)", () => {
  const next = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the fields from the most recent def_upd event", async () => {
    const { query } = await import("../../db/index.js");
    (query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { parsed_data: { asset: "XLM", zkmeVerifier: "GZKME", cooperator: "GCOOP" } },
    ]);

    const res = makeRes();
    await getFactoryDefaults({} as any, res as any, next);

    expect(res.json).toHaveBeenCalledWith({
      defaultAsset: "XLM",
      defaultZkmeVerifier: "GZKME",
      defaultCooperator: "GCOOP",
    });
  });

  it("returns nulls when no def_upd event has been indexed", async () => {
    const { query } = await import("../../db/index.js");
    (query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const res = makeRes();
    await getFactoryDefaults({} as any, res as any, next);

    expect(res.json).toHaveBeenCalledWith({
      defaultAsset: null,
      defaultZkmeVerifier: null,
      defaultCooperator: null,
    });
  });
});

describe("getFactoryEvents (#842)", () => {
  const next = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns paginated factory events in reverse ledger order", async () => {
    const { query } = await import("../../db/index.js");
    const mockQuery = query as ReturnType<typeof vi.fn>;
    mockQuery.mockResolvedValueOnce([
      { event_type: "v_create", ledger: 300, tx_hash: "tx2", created_at: new Date("2026-01-02") },
      { event_type: "adm_xfr", ledger: 200, tx_hash: "tx1", created_at: new Date("2026-01-01") },
    ]);
    mockQuery.mockResolvedValueOnce([{ count: "2" }]);

    const req = { query: { page: 1, pageSize: 20 } };
    const res = makeRes();
    await getFactoryEvents(req as any, res as any, next);

    expect(res.json).toHaveBeenCalledWith({
      data: [
        { eventType: "v_create", ledger: 300, txHash: "tx2", createdAt: new Date("2026-01-02") },
        { eventType: "adm_xfr", ledger: 200, txHash: "tx1", createdAt: new Date("2026-01-01") },
      ],
      total: 2,
      page: 1,
      pageSize: 20,
    });
  });
});

describe("getFactoryInfo (#835)", () => {
  const next = vi.fn();
  const CONTRACT_ID = "CFACTORY000000000000000000000000000000000000000000000";

  beforeEach(() => {
    vi.clearAllMocks();
    config.stellar.vaultFactoryContractId = CONTRACT_ID;
  });

  it("returns factory metadata sourced from indexed event history", async () => {
    const { query } = await import("../../db/index.js");
    const mockQuery = query as ReturnType<typeof vi.fn>;
    // 1. latest admin transfer, 2. earliest factory event, 3. vault count,
    // 4. latest wasm hash
    mockQuery.mockResolvedValueOnce([{ new_admin: "GADMIN2" }]);
    mockQuery.mockResolvedValueOnce([{ created_at: new Date("2026-01-01") }]);
    mockQuery.mockResolvedValueOnce([{ count: "7" }]);
    mockQuery.mockResolvedValueOnce([{ new_hash: "abc123" }]);

    const res = makeRes();
    await getFactoryInfo({} as any, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      contractId: CONTRACT_ID,
      admin: "GADMIN2",
      currentWasmHash: "abc123",
      vaultCount: 7,
      createdAt: new Date("2026-01-01"),
    });
  });

  it("returns nulls for admin, wasm hash and createdAt when nothing has been indexed", async () => {
    const { query } = await import("../../db/index.js");
    const mockQuery = query as ReturnType<typeof vi.fn>;
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([{ created_at: null }]);
    mockQuery.mockResolvedValueOnce([{ count: "0" }]);
    mockQuery.mockResolvedValueOnce([]);

    const res = makeRes();
    await getFactoryInfo({} as any, res as any, next);

    expect(res.json).toHaveBeenCalledWith({
      contractId: CONTRACT_ID,
      admin: null,
      currentWasmHash: null,
      vaultCount: 0,
      createdAt: null,
    });
  });

  it("returns 503 when VAULT_FACTORY_CONTRACT_ID is not configured", async () => {
    const { query } = await import("../../db/index.js");
    config.stellar.vaultFactoryContractId = "";
    const mockQuery = query as ReturnType<typeof vi.fn>;

    const res = makeRes();
    await getFactoryInfo({} as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "ServiceUnavailable" }),
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("getVaultCount (#836)", () => {
  const next = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a total equal to the sum of the byState buckets", async () => {
    const { query } = await import("../../db/index.js");
    (query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { Funding: "3", Active: "5", Matured: "1", Cancelled: "2" },
    ]);

    const res = makeRes();
    await getVaultCount({} as any, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      total: 11,
      byState: { Funding: 3, Active: 5, Matured: 1, Cancelled: 2 },
    });
  });

  it("zero-fills states with no rows and sets a 30s cache header", async () => {
    const { query } = await import("../../db/index.js");
    (query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{}]);

    const res = makeRes();
    await getVaultCount({} as any, res as any, next);

    expect(res.json).toHaveBeenCalledWith({
      total: 0,
      byState: { Funding: 0, Active: 0, Matured: 0, Cancelled: 0 },
    });
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "max-age=30");
  });

  it("counts only non-archived vaults", async () => {
    const { query } = await import("../../db/index.js");
    (query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { Funding: "1", Active: "1", Matured: "0", Cancelled: "0" },
    ]);

    await getVaultCount({} as any, makeRes() as any, next);

    const [sql] = (query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sql).toContain("archived = FALSE");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { inflateRawSync } from "node:zlib";

vi.mock("../../db/index.js", () => ({ query: vi.fn() }));
vi.mock("../../services/stellar.js", () => ({ readKycVerified: vi.fn() }));

/** Minimal ZIP reader (local file headers only) to assert exportUserData produces a real, extractable archive. */
function readZipEntries(zip: Buffer): Record<string, Buffer> {
  const entries: Record<string, Buffer> = {};
  let offset = 0;
  while (offset < zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = zip.readUInt32LE(offset + 18);
    const uncompressedSize = zip.readUInt32LE(offset + 22);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = zip.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const dataStart = nameStart + nameLength + extraLength;
    const compressed = zip.subarray(dataStart, dataStart + compressedSize);
    const content = inflateRawSync(compressed);
    expect(content.length).toBe(uncompressedSize);
    entries[name] = content;
    offset = dataStart + compressedSize;
  }
  return entries;
}

async function getTestContext() {
  const { query } = await import("../../db/index.js");
  const { UserService } = await import("../../services/user.js");
  const service = new UserService();
  return { query: query as ReturnType<typeof vi.fn>, service };
}

describe("UserService Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getUser", () => {
    it("returns a user when address exists", async () => {
      const { query, service } = await getTestContext();
      query.mockResolvedValue([
        { id: 1, address: "GABCDEF", kyc_verified: true, created_at: new Date(), updated_at: new Date() },
      ]);

      const user = await service.getUser("GABCDEF");
      expect(user).not.toBeNull();
      expect(user!.address).toBe("GABCDEF");
      expect(user!.kycVerified).toBe(true);
    });

    it("returns null when address does not exist", async () => {
      const { query, service } = await getTestContext();
      query.mockResolvedValue([]);

      const user = await service.getUser("GUNKNOWN");
      expect(user).toBeNull();
    });
  });

  describe("getUserPortfolio", () => {
    it("returns positions with totalDeposited", async () => {
      const { query, service } = await getTestContext();
      query.mockResolvedValue([
        {
          id: 1,
          user_address: "GABCDEF",
          vault_id: 10,
          shares: "1000",
          deposited: "500",
          last_claimed_epoch: 2,
          updated_at: new Date(),
        },
      ]);

      const portfolio = await service.getUserPortfolio("GABCDEF");
      expect(portfolio).toHaveProperty("positions");
      expect(portfolio).toHaveProperty("totalDeposited");
      expect(Array.isArray(portfolio.positions)).toBe(true);
      expect(portfolio.positions.length).toBe(1);
      expect(portfolio.positions[0].userAddress).toBe("GABCDEF");
      expect(portfolio.positions[0].shares).toBe("1000");
      expect(portfolio.totalDeposited).toBe("500");
    });

    it("returns empty positions and zero total when no positions", async () => {
      const { query, service } = await getTestContext();
      query.mockResolvedValue([]);

      const portfolio = await service.getUserPortfolio("GEMPTY");
      expect(portfolio.positions).toEqual([]);
      expect(portfolio.totalDeposited).toBe("0");
    });
  });

  describe("searchUsers", () => {
    it("returns matching users by partial address", async () => {
      const { query, service } = await getTestContext();
      query.mockResolvedValue([
        { id: 1, address: "GXYZ123", kyc_verified: false, created_at: new Date(), updated_at: new Date() },
        { id: 2, address: "GXYZ456", kyc_verified: true, created_at: new Date(), updated_at: new Date() },
      ]);

      const users = await service.searchUsers("GXYZ");
      expect(users.length).toBe(2);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("ILIKE"),
        ["%GXYZ%"],
      );
    });

    it("returns empty array when no matches", async () => {
      const { query, service } = await getTestContext();
      query.mockResolvedValue([]);

      const users = await service.searchUsers("NOMATCH");
      expect(users.length).toBe(0);
    });
  });

  describe("countUsers", () => {
    it("returns the total user count", async () => {
      const { query, service } = await getTestContext();
      query.mockResolvedValue([{ count: "5" }]);

      const count = await service.countUsers();
      expect(count).toBe(5);
    });

    it("returns 0 when no users exist", async () => {
      const { query, service } = await getTestContext();
      query.mockResolvedValue([{ count: "0" }]);

      const count = await service.countUsers();
      expect(count).toBe(0);
    });
  });
});

describe("UserService.getUserYieldHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns paginated yield history for a user", async () => {
    const { query, service } = await getTestContext();
    const now = new Date();
    query
      .mockResolvedValueOnce([
        {
          contract_id: "CVAULT00000000000000000000000000000000000000000000000000",
          event_type: "yield_clm",
          payload: { user: "GABCDEF", epoch: 3, amount: "1000", timestamp: "1700000000" },
          created_at: now,
        },
      ])
      .mockResolvedValueOnce([{ count: "1" }]);

    const result = await service.getUserYieldHistory("GABCDEF", 1, 20);

    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].vaultContractId).toBe("CVAULT00000000000000000000000000000000000000000000000000");
    expect(result.data[0].epoch).toBe(3);
    expect(result.data[0].amount).toBe("1000");
    expect(result.data[0].eventType).toBe("yield_clm");
    expect(result.data[0].timestamp).toBe(new Date(1700000000 * 1000).toISOString());
  });

  it("falls back to created_at when payload has no timestamp", async () => {
    const { query, service } = await getTestContext();
    const now = new Date("2024-01-01T00:00:00.000Z");
    query
      .mockResolvedValueOnce([
        {
          contract_id: "CVAULT00000000000000000000000000000000000000000000000000",
          event_type: "prt_yld",
          payload: { user: "GABCDEF", amount: "500" },
          created_at: now,
        },
      ])
      .mockResolvedValueOnce([{ count: "1" }]);

    const result = await service.getUserYieldHistory("GABCDEF", 1, 20);

    expect(result.data[0].timestamp).toBe(now.toISOString());
    expect(result.data[0].epoch).toBeNull();
  });

  it("returns empty data when no yield events found", async () => {
    const { query, service } = await getTestContext();
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: "0" }]);

    const result = await service.getUserYieldHistory("GNOYIELD0000000000000000000000000000000000000000000000000", 1, 20);

    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("applies correct offset for page 2", async () => {
    const { query, service } = await getTestContext();
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: "0" }]);

    await service.getUserYieldHistory("GABCDEF", 2, 10);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("OFFSET $3"),
      ["GABCDEF", 10, 10],
    );
  });
});

describe("User Controller - search validation", () => {
  it("exports user data as a zip archive with the expected metadata", async () => {
    const { query } = await import("../../db/index.js");
    const { exportUserData } = await import("./users.js");
    const mockQuery = query as ReturnType<typeof vi.fn>;

    mockQuery.mockResolvedValueOnce([
      {
        id: 1,
        address: "GABCDEF",
        kyc_verified: true,
        created_at: new Date("2025-01-01T00:00:00.000Z"),
        updated_at: new Date("2025-01-02T00:00:00.000Z"),
      },
    ]);
    mockQuery.mockResolvedValueOnce([
      {
        id: 10,
        user_address: "GABCDEF",
        vault_id: 2,
        shares: "100",
        deposited: "50",
        last_claimed_epoch: 1,
        updated_at: new Date("2025-01-03T00:00:00.000Z"),
      },
    ]);
    mockQuery.mockResolvedValueOnce([
      {
        contract_id: "CVAULT00000000000000000000000000000000000000000000000000",
        event_type: "yield_claimed",
        payload: { user: "GABCDEF", amount: "100", epoch: 3, timestamp: "1735689600" },
        created_at: new Date("2025-01-04T00:00:00.000Z"),
      },
    ]);
    mockQuery.mockResolvedValueOnce([
      {
        id: 22,
        ledger: 42,
        tx_hash: "tx1",
        contract_id: "CVAULT00000000000000000000000000000000000000000000000000",
        event_type: "yield_claimed",
        payload: { user: "GABCDEF" },
        created_at: new Date("2025-01-05T00:00:00.000Z"),
      },
    ]);

    const req = { params: { address: "GABCDEF" } } as any;
    const res = { set: vi.fn(), end: vi.fn(), status: vi.fn().mockReturnThis() } as any;
    const next = vi.fn();

    await exportUserData(req, res, next);

    expect(res.set).toHaveBeenCalledWith("Content-Type", "application/zip");
    expect(res.set).toHaveBeenCalledWith("Content-Disposition", expect.stringContaining("attachment; filename=\"user-GABCDEF-data-export.zip\""));
    expect(res.end).toHaveBeenCalledWith(expect.any(Buffer));

    const zip = res.end.mock.calls[0][0] as Buffer;
    const entries = readZipEntries(zip);
    expect(Object.keys(entries).sort()).toEqual(
      ["events.json", "positions.json", "user.json", "yield-history.json"].sort(),
    );
    expect(JSON.parse(entries["user.json"].toString("utf8"))).toMatchObject({ address: "GABCDEF" });
    expect(JSON.parse(entries["positions.json"].toString("utf8"))).toHaveLength(1);
  });
  it("searchUsers controller calls service with query param", async () => {
    const { query } = await import("../../db/index.js");
    (query as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { searchUsers } = await import("./users.js");
    const req = { query: { search: "GXYZ" } } as any;
    const res = { json: vi.fn() } as any;
    const next = vi.fn();

    await searchUsers(req, res, next);

    expect(res.json).toHaveBeenCalledWith([]);
  });

  it("getUserKyc controller returns live KYC status", async () => {
    const { readKycVerified } = await import("../../services/stellar.js");
    (readKycVerified as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const { getUserKyc } = await import("./users.js");
    const req = {
      params: { address: "GABCDEF" },
      query: { vaultId: "CC_VAULT" },
    } as any;
    const res = { json: vi.fn() } as any;
    const next = vi.fn();

    await getUserKyc(req, res, next);

    expect(readKycVerified).toHaveBeenCalledWith("CC_VAULT", "GABCDEF");
    expect(res.json).toHaveBeenCalledWith({ verified: true });
  });

  it("getUserShareHistory controller returns share snapshots", async () => {
    const { query } = await import("../../db/index.js");
    const recordedAt = new Date("2025-01-01T00:00:00.000Z");
    (query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { epoch: 1, shares: "100", recorded_at: recordedAt },
    ]);

    const { getUserShareHistory } = await import("./users.js");
    const req = {
      params: { address: "GABCDEF" },
      query: { vaultId: "CDLZFC3SYJYHZDQA6M57EYUC2XBDA6LQF3M6KFRDZ7TXJYJL2K3B" },
    } as any;
    const res = { json: vi.fn() } as any;
    const next = vi.fn();

    await getUserShareHistory(req, res, next);

    expect(res.json).toHaveBeenCalledWith([
      { epoch: 1, shares: "100", recordedAt },
    ]);
  });
});

import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getEarlyRedemptionFeePreview: vi.fn(),
  getVaultExportData: vi.fn(),
  listVaultHolders: vi.fn(),
  countVaultHolders: vi.fn(),
  getVaultHoldersForExport: vi.fn(),
}));

vi.mock("../../services/vault.js", () => ({
  VaultService: vi.fn(() => ({
    getEarlyRedemptionFeePreview: mocks.getEarlyRedemptionFeePreview,
    getVaultExportData: mocks.getVaultExportData,
    listVaultHolders: mocks.listVaultHolders,
    countVaultHolders: mocks.countVaultHolders,
    getVaultHoldersForExport: mocks.getVaultHoldersForExport,
  })),
}));
vi.mock("../../services/stellar.js", () => ({
  readTotalAssets: vi.fn(),
  readVaultState: vi.fn(),
}));
vi.mock("../../db/index.js", () => ({ query: vi.fn() }));

import {
  getEarlyRedemptionFee,
  exportVaultCsv,
  getVaultHolders,
  getVaultHolderCount,
  exportVaultHoldersCsv,
} from "./vaults.js";

const CONTRACT_ID = "CDLZFC3SYJYHZDQA6M57EYUC2XBDA6LQF3M6KFRDZ7TXJYJL2K3B";

function makeRes() {
  return {
    json: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
}

describe("getEarlyRedemptionFee", () => {
  const next = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when shares is missing", async () => {
    const res = makeRes();
    const req = { params: { contractId: CONTRACT_ID }, query: {} } as any;

    await getEarlyRedemptionFee(req, res as any, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.getEarlyRedemptionFeePreview).not.toHaveBeenCalled();
  });

  it("returns 400 when shares is zero", async () => {
    const res = makeRes();
    const req = { params: { contractId: CONTRACT_ID }, query: { shares: "0" } } as any;

    await getEarlyRedemptionFee(req, res as any, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.getEarlyRedemptionFeePreview).not.toHaveBeenCalled();
  });

  it("returns 400 when shares is non-numeric", async () => {
    const res = makeRes();
    const req = { params: { contractId: CONTRACT_ID }, query: { shares: "abc" } } as any;

    await getEarlyRedemptionFee(req, res as any, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when the vault is unknown", async () => {
    mocks.getEarlyRedemptionFeePreview.mockResolvedValue(null);
    const res = makeRes();
    const req = { params: { contractId: CONTRACT_ID }, query: { shares: "1000" } } as any;

    await getEarlyRedemptionFee(req, res as any, next);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns the fee breakdown for a valid share amount", async () => {
    const preview = {
      grossAssets: "1000",
      feeBps: 250,
      feeAmount: "25",
      netAssets: "975",
    };
    mocks.getEarlyRedemptionFeePreview.mockResolvedValue(preview);
    const res = makeRes();
    const req = { params: { contractId: CONTRACT_ID }, query: { shares: "1000" } } as any;

    await getEarlyRedemptionFee(req, res as any, next);

    expect(mocks.getEarlyRedemptionFeePreview).toHaveBeenCalledWith(CONTRACT_ID, 1000n);
    expect(res.json).toHaveBeenCalledWith(preview);
  });
});

describe("exportVaultCsv", () => {
  const next = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the vault does not exist", async () => {
    mocks.getVaultExportData.mockResolvedValue(null);
    const res = makeRes();
    const req = { params: { contractId: CONTRACT_ID } } as any;

    await exportVaultCsv(req, res as any, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("returns a CSV attachment with header and data rows", async () => {
    mocks.getVaultExportData.mockResolvedValue({
      contractId: CONTRACT_ID,
      state: "Active",
      totalAssets: "1000",
      totalSupply: "900",
      depositorCount: 3,
      epochCount: 4,
      expectedApy: 500,
      maturityDate: new Date("2025-12-31T00:00:00.000Z"),
    });
    const res = makeRes();
    const req = { params: { contractId: CONTRACT_ID } } as any;

    await exportVaultCsv(req, res as any, next);

    expect(res.set).toHaveBeenCalledWith("Content-Type", "text/csv");
    expect(res.set).toHaveBeenCalledWith(
      "Content-Disposition",
      `attachment; filename="vault-${CONTRACT_ID}.csv"`,
    );

    const csv = (res.send as any).mock.calls[0][0] as string;
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe(
      "contractId,state,totalAssets,totalSupply,depositorCount,epochCount,expectedApy,maturityDate",
    );
    expect(lines[1]).toBe(
      `${CONTRACT_ID},Active,1000,900,3,4,500,2025-12-31T00:00:00.000Z`,
    );
  });

  it("emits empty fields for null apy and maturity date", async () => {
    mocks.getVaultExportData.mockResolvedValue({
      contractId: CONTRACT_ID,
      state: "Funding",
      totalAssets: "0",
      totalSupply: "0",
      depositorCount: 0,
      epochCount: 0,
      expectedApy: null,
      maturityDate: null,
    });
    const res = makeRes();
    const req = { params: { contractId: CONTRACT_ID } } as any;

    await exportVaultCsv(req, res as any, next);

    const csv = (res.send as any).mock.calls[0][0] as string;
    const lines = csv.trim().split("\r\n");
    expect(lines[1]).toBe(`${CONTRACT_ID},Funding,0,0,0,0,,`);
  });
});

describe("getVaultHolders", () => {
  const next = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns paginated active holders sorted by shares by default", async () => {
    const result = {
      data: [
        {
          userAddress: "GUSER1",
          shares: "200",
          deposited: "100",
          lastUpdatedAt: new Date("2025-01-01T00:00:00.000Z"),
        },
      ],
      total: 3,
      page: 1,
      pageSize: 20,
    };
    mocks.listVaultHolders.mockResolvedValue(result);
    const res = makeRes();
    const req = { params: { contractId: CONTRACT_ID }, query: {} } as any;

    await getVaultHolders(req, res as any, next);

    expect(mocks.listVaultHolders).toHaveBeenCalledWith(CONTRACT_ID, {
      page: 1,
      pageSize: 20,
      sort: "shares",
    });
    expect(res.set).toHaveBeenCalledWith("Cache-Control", "max-age=10, stale-while-revalidate=60");
    expect(res.json).toHaveBeenCalledWith(result);
  });

  it("returns 404 when listing holders for an unknown vault", async () => {
    mocks.listVaultHolders.mockResolvedValue(null);
    const res = makeRes();
    const req = { params: { contractId: CONTRACT_ID }, query: {} } as any;

    await getVaultHolders(req, res as any, next);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("getVaultHolderCount", () => {
  const next = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns active holder count with a 30 second cache header", async () => {
    mocks.countVaultHolders.mockResolvedValue(7);
    const res = makeRes();
    const req = { params: { contractId: CONTRACT_ID } } as any;

    await getVaultHolderCount(req, res as any, next);

    expect(res.set).toHaveBeenCalledWith("Cache-Control", "max-age=30");
    expect(res.json).toHaveBeenCalledWith({ count: 7 });
  });

  it("returns 404 when counting holders for an unknown vault", async () => {
    mocks.countVaultHolders.mockResolvedValue(null);
    const res = makeRes();
    const req = { params: { contractId: CONTRACT_ID } } as any;

    await getVaultHolderCount(req, res as any, next);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("exportVaultHoldersCsv", () => {
  const next = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when exporting holders for an unknown vault", async () => {
    mocks.getVaultHoldersForExport.mockResolvedValue(null);
    const res = makeRes();
    const req = { params: { contractId: CONTRACT_ID } } as any;

    await exportVaultHoldersCsv(req, res as any, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("returns an Excel-friendly CSV attachment for active holders", async () => {
    mocks.getVaultHoldersForExport.mockResolvedValue([
      {
        userAddress: "GUSER1",
        shares: "200",
        deposited: "100",
        lastUpdatedAt: new Date("2025-01-01T00:00:00.000Z"),
      },
      {
        userAddress: "GUSER2",
        shares: "50",
        deposited: "75",
        lastUpdatedAt: new Date("2025-01-02T00:00:00.000Z"),
      },
    ]);
    const res = makeRes();
    const req = { params: { contractId: CONTRACT_ID } } as any;

    await exportVaultHoldersCsv(req, res as any, next);

    expect(res.set).toHaveBeenCalledWith("Content-Type", "text/csv");
    expect(res.set).toHaveBeenCalledWith(
      "Content-Disposition",
      `attachment; filename="holders-${CONTRACT_ID}.csv"`,
    );
    const csv = (res.send as any).mock.calls[0][0] as string;
    expect(csv).toBe(
      "userAddress,shares,deposited,lastUpdatedAt\r\n" +
      "GUSER1,200,100,2025-01-01T00:00:00.000Z\r\n" +
      "GUSER2,50,75,2025-01-02T00:00:00.000Z\r\n",
    );
  });
});

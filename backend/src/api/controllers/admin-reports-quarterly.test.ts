import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";

vi.mock("../../db/index.js", () => ({
  query: vi.fn(async (sql: string) => {
    if (sql.includes("api_keys")) {
      return [{ id: 1, key_hash: "hash", role: "admin", label: "test", created_at: new Date() }];
    }
    if (sql.includes("FROM epochs")) {
      return [{ total_yield: "1500000000" }];
    }
    if (sql.includes("FROM transfer_fees")) {
      return [{ total_fees: "75000" }];
    }
    if (sql.includes("FROM vault_tvl_snapshots")) {
      return [{ peak_tvl: "10000000" }];
    }
    if (sql.includes("FROM user_vault_positions")) {
      return [{ count: "128" }];
    }
    return [];
  }),
}));

describe("GET /api/v1/admin/reports/quarterly (#1114)", () => {
  const app = createApp();

  it("returns quarterly report with yield, fees, peak TVL, and unique holders", async () => {
    const res = await request(app)
      .get("/api/v1/admin/reports/quarterly?year=2026&quarter=1")
      .set("x-api-key", "test-key");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      year: 2026,
      quarter: 1,
      totalYieldPaid: "1500000000",
      totalFeesEarned: "75000",
      peakTvlUsd: "10000000",
      uniqueHolders: 128,
    });
  });

  it("rejects invalid quarter numbers", async () => {
    const res = await request(app)
      .get("/api/v1/admin/reports/quarterly?year=2026&quarter=5")
      .set("x-api-key", "test-key");

    expect(res.status).toBe(400);
  });
});

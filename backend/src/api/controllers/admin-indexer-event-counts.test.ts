import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";

vi.mock("../../services/indexerSingleton.js", () => ({
  indexer: {
    isRunning: vi.fn(() => true),
    getLastIndexedLedger: vi.fn(async () => 1000),
    getLastTickAt: vi.fn(() => new Date()),
    getEventsIndexedCount: vi.fn(async () => 42),
    getEventCountsPerContract: vi.fn(async () => [
      {
        contractId: "CAAA",
        totalEvents: 10,
        eventsByType: { deposit: 6, withdraw: 4 },
      },
      {
        contractId: "CBBB",
        totalEvents: 0,
        eventsByType: {},
      },
    ]),
  },
}));

vi.mock("../../db/index.js", () => ({
  query: vi.fn(async (sql: string) => {
    if (sql.includes("api_keys")) {
      return [{ id: 1, key_hash: "hash", role: "admin", label: "test", created_at: new Date() }];
    }
    return [];
  }),
}));

describe("GET /api/v1/admin/indexer/event-counts (#1108)", () => {
  const app = createApp();

  it("returns event counts per contract with totalEvents matching events", async () => {
    const res = await request(app)
      .get("/api/v1/admin/indexer/event-counts")
      .set("x-api-key", "test-key");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toEqual({
      contractId: "CAAA",
      totalEvents: 10,
      eventsByType: { deposit: 6, withdraw: 4 },
    });
    expect(res.body[1]).toEqual({
      contractId: "CBBB",
      totalEvents: 0,
      eventsByType: {},
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// The DB layer is mocked (consistent with CI - no live postgres required),
// mirroring the existing deposit-indexing E2E test. `queryMock` routes on SQL
// text to stand in for a seeded vault, user, and three epochs (see
// backend/src/db/seed.ts for the equivalent live-DB seed data).
vi.mock("./db/index.js", () => ({ query: vi.fn().mockResolvedValue([]) }));
vi.mock("./logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));
vi.mock("./services/stellar.js", () => ({ getSorobanRpc: vi.fn() }));
vi.mock("pino-http", () => ({ pinoHttp: () => (_req: any, _res: any, next: any) => next() }));

import { Indexer } from "./services/indexer.js";
import { createApp } from "./app.js";
import { VAULT_CONTRACT, USER_ADDRESS, makeYieldClaimedEvent } from "./test/fixtures/events.js";

const EPOCHS = [
  { epoch: 1, yield_amount: "1000", total_shares: "1000" },
  { epoch: 2, yield_amount: "2000", total_shares: "1000" },
  { epoch: 3, yield_amount: "3000", total_shares: "1000" },
];

describe("E2E: yield claim flow (#695)", () => {
  let queryMock: ReturnType<typeof vi.fn>;
  let lastClaimedEpoch: number;
  let totalClaimed: bigint;

  beforeEach(async () => {
    vi.clearAllMocks();
    lastClaimedEpoch = -1;
    totalClaimed = 0n;

    const { query } = await import("./db/index.js");
    queryMock = query as ReturnType<typeof vi.fn>;
    queryMock.mockImplementation((sql: string, params: unknown[] = []) => {
      if (sql.includes("SELECT id FROM indexed_events WHERE tx_hash")) {
        return Promise.resolve([]);
      }
      if (sql.includes("SET last_claimed_epoch = GREATEST")) {
        lastClaimedEpoch = Math.max(lastClaimedEpoch, Number(params[0]));
        return Promise.resolve([]);
      }
      if (sql.includes("INSERT INTO indexed_events") && sql.includes("'yield_claimed'")) {
        const payload = JSON.parse(String(params[3]));
        totalClaimed += BigInt(payload.amount);
        return Promise.resolve([]);
      }
      if (sql.includes("uvp.shares, uvp.last_claimed_epoch")) {
        return Promise.resolve([{ shares: "1000", last_claimed_epoch: lastClaimedEpoch }]);
      }
      if (sql.includes("e.epoch, e.yield_amount, e.total_shares")) {
        return Promise.resolve(EPOCHS);
      }
      if (sql.includes("SELECT v.contract_id") && sql.includes("uvp.shares > 0")) {
        return Promise.resolve([{ contract_id: VAULT_CONTRACT }]);
      }
      if (sql.includes("total_claimed")) {
        return Promise.resolve([{ total_claimed: totalClaimed.toString() }]);
      }
      return Promise.resolve([]);
    });
  });

  it("reduces pending yield and updates the user's totalClaimed after a claim is indexed", async () => {
    const app = createApp();
    const { default: supertest } = await import("supertest");

    const before = await supertest(app).get(
      `/api/v1/yields/${VAULT_CONTRACT}/pending/${USER_ADDRESS}`,
    );
    expect(before.status).toBe(200);
    expect(before.body.pendingYield).toBe("6000");
    expect(before.body.epochs).toEqual([1, 2, 3]);

    const summaryBefore = await supertest(app).get(`/api/v1/users/${USER_ADDRESS}/yield-summary`);
    expect(summaryBefore.status).toBe(200);
    expect(summaryBefore.body.totalClaimed).toBe("0");

    const indexer = new Indexer();
    await indexer.processEvent(
      makeYieldClaimedEvent({ contractId: VAULT_CONTRACT, user: USER_ADDRESS, amount: 2000n, epoch: 2 }),
    );

    const after = await supertest(app).get(
      `/api/v1/yields/${VAULT_CONTRACT}/pending/${USER_ADDRESS}`,
    );
    expect(after.status).toBe(200);
    expect(after.body.pendingYield).toBe("3000");
    expect(after.body.epochs).toEqual([3]);
    expect(after.body.claimedEpochs).toEqual([1, 2]);
    expect(BigInt(after.body.pendingYield)).toBeLessThan(BigInt(before.body.pendingYield));

    const summaryAfter = await supertest(app).get(`/api/v1/users/${USER_ADDRESS}/yield-summary`);
    expect(summaryAfter.status).toBe(200);
    expect(summaryAfter.body.totalClaimed).toBe("2000");
  });
});

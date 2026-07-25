import { describe, it, expect, vi, beforeEach } from "vitest";

// The DB layer is mocked (consistent with CI - no live postgres required),
// mirroring the existing deposit-indexing E2E test. `queryMock` routes on SQL
// text so it can serve both the indexer's writes and the API's reads.
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
import { VAULT_CONTRACT, makeVaultStateChangedEvent } from "./test/fixtures/events.js";

function makeVaultRow(state: string) {
  const timestamp = new Date("2025-01-01T00:00:00.000Z");
  return {
    id: 1,
    contract_id: VAULT_CONTRACT,
    factory_id: "FACTORY123",
    asset: "XLM",
    name: "Stellar Lumens Vault",
    symbol: "SVXLM",
    state,
    total_assets: "1000000",
    total_supply: "500000",
    total_shares_ever_minted: "500000",
    total_shares_ever_burned: "0",
    created_at: timestamp,
    updated_at: timestamp,
    funding_target: "1000000",
    funding_deadline: null,
    min_deposit: null,
    max_deposit_per_user: null,
    zkme_verifier_address: null,
    rwa_name: null,
    rwa_symbol: null,
    rwa_document_uri: null,
    rwa_category: null,
    depositor_count: 3,
  };
}

describe("E2E: vault state transitions (#696)", () => {
  let queryMock: ReturnType<typeof vi.fn>;
  let currentState: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    currentState = "Funding";
    const { query } = await import("./db/index.js");
    queryMock = query as ReturnType<typeof vi.fn>;
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes("UPDATE vaults SET state")) {
        return Promise.resolve([]);
      }
      if (sql.includes("FROM vaults v") && sql.includes("WHERE v.contract_id = $1")) {
        return Promise.resolve([makeVaultRow(currentState)]);
      }
      return Promise.resolve([]);
    });
  });

  it("reflects each state transition via GET /api/v1/vaults/:contractId and fires vault.matured exactly once", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const indexer = new Indexer({ notify } as any);
    const app = createApp();
    const { default: supertest } = await import("supertest");

    const initial = await supertest(app).get(`/api/v1/vaults/${VAULT_CONTRACT}`);
    expect(initial.status).toBe(200);
    expect(initial.body.state).toBe("Funding");

    currentState = "Active";
    await indexer.processEvent(
      makeVaultStateChangedEvent({ oldState: "Funding", newState: "Active" }),
    );
    const afterActive = await supertest(app).get(`/api/v1/vaults/${VAULT_CONTRACT}`);
    expect(afterActive.status).toBe(200);
    expect(afterActive.body.state).toBe("Active");

    currentState = "Matured";
    await indexer.processEvent(
      makeVaultStateChangedEvent({ oldState: "Active", newState: "Matured" }),
    );
    const afterMatured = await supertest(app).get(`/api/v1/vaults/${VAULT_CONTRACT}`);
    expect(afterMatured.status).toBe(200);
    expect(afterMatured.body.state).toBe("Matured");

    const maturedCalls = notify.mock.calls.filter((call) => call[0] === "vault.matured");
    expect(maturedCalls).toHaveLength(1);
    expect(maturedCalls[0]?.[1]).toMatchObject({ contractId: VAULT_CONTRACT });

    const stateChangedCalls = notify.mock.calls.filter((call) => call[0] === "vault_state_changed");
    expect(stateChangedCalls).toHaveLength(2);
  });

  it("does not fire vault.matured for a non-maturity transition", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const indexer = new Indexer({ notify } as any);

    currentState = "Active";
    await indexer.processEvent(
      makeVaultStateChangedEvent({ oldState: "Funding", newState: "Active" }),
    );

    const maturedCalls = notify.mock.calls.filter((call) => call[0] === "vault.matured");
    expect(maturedCalls).toHaveLength(0);
  });
});

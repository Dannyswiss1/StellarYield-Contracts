import { describe, it, expect, vi, beforeEach } from "vitest";
import { nativeToScVal } from "@stellar/stellar-sdk";

vi.mock("../db/index.js", () => ({ query: vi.fn().mockResolvedValue([]) }));
vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("./stellar.js", () => ({ getSorobanRpc: vi.fn() }));
vi.mock("./vault.js", () => ({ VaultService: vi.fn().mockImplementation(() => ({})) }));
vi.mock("./user.js", () => ({
  UserService: vi.fn().mockImplementation(() => ({ upsertUser: vi.fn().mockResolvedValue(undefined) })),
}));
vi.mock("./notifications.js", () => ({ NotificationService: vi.fn().mockImplementation(() => ({})) }));
vi.mock("pino-http", () => ({ pinoHttp: () => (_req: any, _res: any, next: any) => next() }));

import { Indexer, parseTransferEvent } from "./indexer.js";
import * as db from "../db/index.js";
import { makeTransferEvent, VAULT_CONTRACT } from "../test/fixtures/events.js";

const SENDER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1";
const RECIPIENT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA2";

/** Every query the indexer issued, as { sql, params } pairs. */
function allCalls(): Array<{ sql: string; params: unknown[] }> {
  return vi.mocked(db.query).mock.calls.map(([sql, params]) => ({
    sql: String(sql),
    params: (params ?? []) as unknown[],
  }));
}

/** The transfers-table insert, if the run issued one. */
function transferInsert() {
  return allCalls().find((c) => c.sql.includes("INTO transfers"));
}

describe("parseTransferEvent (#1074)", () => {
  it("parses the sender, recipient and amount", () => {
    const result = parseTransferEvent(
      makeTransferEvent({ from: SENDER, to: RECIPIENT, amount: 1234n }),
    );

    expect(result).toEqual({ from: SENDER, to: RECIPIENT, amount: 1234n });
  });

  it("reads the amount from the value, not from a topic", () => {
    // The vault publishes ("transfer", from, to) with a bare i128 value, so
    // there is no tuple to unpack and nothing positional to get wrong.
    const result = parseTransferEvent(makeTransferEvent({ amount: 777n }));

    expect(result?.amount).toBe(777n);
  });

  it("returns a bigint amount so a large i128 keeps full precision", () => {
    const huge = 170141183460469231731687303715884105727n;

    const result = parseTransferEvent(makeTransferEvent({ amount: huge }));

    expect(result?.amount).toBe(huge);
  });

  it("accepts base64-encoded topics and value, as the RPC delivers them", () => {
    const encoded = {
      topics: [
        nativeToScVal("transfer").toXDR("base64"),
        nativeToScVal(SENDER).toXDR("base64"),
        nativeToScVal(RECIPIENT).toXDR("base64"),
      ],
      value: nativeToScVal(42n).toXDR("base64"),
    };

    expect(parseTransferEvent(encoded)).toEqual({
      from: SENDER,
      to: RECIPIENT,
      amount: 42n,
    });
  });

  it("accepts the `topic` key as well as `topics`", () => {
    const event = makeTransferEvent({ amount: 5n });

    expect(parseTransferEvent({ topic: event.topic, value: event.value })).not.toBeNull();
  });

  it("returns null for a different event symbol", () => {
    // Deposit events also carry addresses in their topics and must not be
    // mistaken for a share transfer.
    const event = {
      topic: [nativeToScVal("deposit"), nativeToScVal(SENDER), nativeToScVal(RECIPIENT)],
      value: nativeToScVal(1000n),
    };

    expect(parseTransferEvent(event)).toBeNull();
  });

  it("returns null when the address pair is missing", () => {
    const event = { topic: [nativeToScVal("transfer")], value: nativeToScVal(1n) };

    expect(parseTransferEvent(event)).toBeNull();
  });

  it("returns null when the value is missing", () => {
    const event = {
      topic: [nativeToScVal("transfer"), nativeToScVal(SENDER), nativeToScVal(RECIPIENT)],
      value: null,
    };

    expect(parseTransferEvent(event)).toBeNull();
  });

  it("returns null for null, non-objects and empty input", () => {
    expect(parseTransferEvent(null)).toBeNull();
    expect(parseTransferEvent(undefined)).toBeNull();
    expect(parseTransferEvent({})).toBeNull();
    expect(parseTransferEvent("not an event")).toBeNull();
  });

  it("returns null for an undecodable topic rather than throwing", () => {
    const event = { topic: ["!!!not-xdr", "also-bad", "still-bad"], value: nativeToScVal(1n) };

    expect(parseTransferEvent(event)).toBeNull();
  });

  it("returns null when an address is empty rather than recording a phantom row", () => {
    // Storing a blank participant would inflate the volume totals and put a
    // meaningless address into sanctions screening.
    const event = {
      topic: [nativeToScVal("transfer"), nativeToScVal(""), nativeToScVal(RECIPIENT)],
      value: nativeToScVal(1n),
    };

    expect(parseTransferEvent(event)).toBeNull();
  });

  it("tolerates extra trailing topics, matching the other event parsers", () => {
    // The vault publishes exactly three topics, but a token implementation that
    // appends more should still be recorded rather than silently dropped. The
    // event symbol is what disambiguates, and it is checked.
    const event = makeTransferEvent({ amount: 250n });

    const result = parseTransferEvent({ ...event, topic: [...event.topic, nativeToScVal("extra")] });

    expect(result).toMatchObject({ amount: 250n });
  });
});

describe("Indexer handling of transfer events (#1074)", () => {
  let indexer: Indexer;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.query).mockResolvedValue([]);
    indexer = new Indexer();
  });

  it("writes the transfer into the transfers table", async () => {
    await indexer.processEvent(
      makeTransferEvent({ from: SENDER, to: RECIPIENT, amount: 999n, ledger: 4242 }),
    );

    const insert = transferInsert();
    expect(insert).toBeDefined();
    // vaultId, from, to, amount, txHash, ledger
    expect(insert!.params.slice(1)).toEqual([
      SENDER,
      RECIPIENT,
      "999",
      expect.any(String),
      4242,
    ]);
  });

  it("stores the transaction hash, not the event id", async () => {
    // Both transfers.tx_hash and transfer_alerts.tx_hash are read back to trace a
    // flagged address to its transaction, so storing the event id there makes
    // that lookup miss.
    const event = makeTransferEvent({ txHash: "tx-abc", id: "evt-xyz" });

    await indexer.processEvent(event);

    expect(transferInsert()!.params[4]).toBe("tx-abc");
  });

  it("resolves the vault from the contract id rather than trusting the event", async () => {
    await indexer.processEvent(makeTransferEvent());

    // The vault id is looked up by contract id and never taken from the event,
    // so a row cannot be filed under the wrong vault.
    const lookup = allCalls().find((c) => c.sql.includes("FROM vaults") && c.sql.includes("id"));
    expect(lookup).toBeDefined();
    expect(lookup!.params).toContain(VAULT_CONTRACT);
  });

  it("passes the amount as a decimal string, never a float", async () => {
    const huge = 170141183460469231731687303715884105727n;

    await indexer.processEvent(makeTransferEvent({ amount: huge }));

    // A JS number here would silently round an i128-sized amount.
    expect(transferInsert()!.params[3]).toBe(huge.toString());
  });

  it("records the event in indexed_events so it appears in the audit trail", async () => {
    await indexer.processEvent(makeTransferEvent({ amount: 11n }));

    const recorded = allCalls().find((c) => c.sql.includes("INTO indexed_events"));
    expect(recorded).toBeDefined();
    expect(recorded!.params).toContain("transfer");
  });

  it("skips a transfer that was already indexed", async () => {
    // The event-level de-duplication is what makes a ledger replay idempotent.
    vi.mocked(db.query).mockImplementation(async (sql: string) =>
      String(sql).includes("FROM indexed_events") ? [{ id: 1 }] : [],
    );

    await indexer.processEvent(makeTransferEvent());

    expect(transferInsert()).toBeUndefined();
  });
});

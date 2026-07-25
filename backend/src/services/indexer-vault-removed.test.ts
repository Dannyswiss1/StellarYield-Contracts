import { describe, it, expect, beforeEach, vi } from "vitest";
import { parseVaultRemovedEvent } from "./indexer.js";
import { nativeToScVal } from "@stellar/stellar-sdk";

const VAULT_CONTRACT = "CDLZFC3SYJYHZDQA6M57EYUC2XBDA6LQF3M6KFRDZ7TXJYJL2K3B";

describe("parseVaultRemovedEvent (#674)", () => {
  it("parses valid vault_removed event", () => {
    const topics = [nativeToScVal("vault_removed")];
    const event = {
      topics,
      contractId: VAULT_CONTRACT,
    };

    const result = parseVaultRemovedEvent(event);

    expect(result).not.toBeNull();
    expect(result?.contractId).toBe(VAULT_CONTRACT);
  });

  it("parses v_rem short-form event name", () => {
    const topics = [nativeToScVal("v_rem")];
    const event = {
      topics,
      contractId: VAULT_CONTRACT,
    };

    const result = parseVaultRemovedEvent(event);

    expect(result).not.toBeNull();
    expect(result?.contractId).toBe(VAULT_CONTRACT);
  });

  it("returns null for malformed event", () => {
    expect(parseVaultRemovedEvent(null)).toBeNull();
    expect(parseVaultRemovedEvent({})).toBeNull();
    expect(parseVaultRemovedEvent({ topics: [] })).toBeNull();
  });

  it("returns null for unrecognized event name", () => {
    const topics = [nativeToScVal("deposit")];
    const event = {
      topics,
      contractId: VAULT_CONTRACT,
    };

    const result = parseVaultRemovedEvent(event);

    expect(result).toBeNull();
  });
});

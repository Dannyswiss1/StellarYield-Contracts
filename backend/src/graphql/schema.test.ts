import { describe, it, expect, vi } from "vitest";
import { graphql } from "graphql";
import { schema } from "./schema.js";

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../services/user.js", () => ({
  UserService: vi.fn(() => ({
    getUser: vi.fn(async (address: string) =>
      address === "GKNOWN"
        ? {
            id: 1,
            address: "GKNOWN",
            kycVerified: true,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          }
        : null,
    ),
  })),
}));

vi.mock("../services/yield.js", () => ({
  YieldService: vi.fn(() => ({
    getVaultEpochs: vi.fn(async () => [
      {
        id: 1,
        vaultId: 1,
        epoch: 1,
        yieldAmount: "1000000000000000000",
        totalShares: "2000000000000000000",
        distributedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ]),
  })),
}));

const { root } = await import("./resolvers.js");

describe("graphql schema", () => {
  it("resolves user by address", async () => {
    const result = await graphql({
      schema,
      source: `{ user(address: "GKNOWN") { address kycVerified } }`,
      rootValue: root,
    });
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({ user: { address: "GKNOWN", kycVerified: true } });
  });

  it("returns null for unknown address", async () => {
    const result = await graphql({
      schema,
      source: `{ user(address: "GUNKNOWN") { address } }`,
      rootValue: root,
    });
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({ user: null });
  });

  it("resolves epochs for a vault", async () => {
    const result = await graphql({
      schema,
      source: `{ epochs(contractId: "CXXX") { epoch yieldAmount yieldPerShare } }`,
      rootValue: root,
    });
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({
      epochs: [{ epoch: 1, yieldAmount: "1000000000000000000", yieldPerShare: "0.500000000000000000" }],
    });
  });
});

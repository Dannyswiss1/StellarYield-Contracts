import { describe, it, expect } from "vitest";
import { readCurrentEpoch, readEpochData } from "./stellar.js";

describe("Stellar SDK Helper Methods", () => {
  it("readCurrentEpoch returns 0 for Funding state", async () => {
    const epoch = await readCurrentEpoch("CC_ANY", async () => "Funding");
    expect(epoch).toBe(0);
  });

  it("readEpochData returns zeroed struct for epoch 0", async () => {
    const data = await readEpochData("CC_ANY", 0);
    expect(data.yieldAmount).toBe(0n);
    expect(data.totalShares).toBe(0n);
    expect(data.timestamp).toBe(0n);
  });
});

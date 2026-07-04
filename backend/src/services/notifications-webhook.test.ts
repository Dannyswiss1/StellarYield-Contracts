import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotificationService } from "./notifications.js";

// Mock the db query function
vi.mock("../db/index.js", () => ({
  query: vi.fn(),
}));

// Mock logger
vi.mock("../logger.js", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { query } from "../db/index.js";

const mockQuery = query as ReturnType<typeof vi.fn>;

describe("NotificationService.verifySignature (#664)", () => {
  const svc = new NotificationService();

  it("returns true for a correctly signed payload", () => {
    const secret = "my-secret";
    const payload = '{"event":"test"}';
    // Compute expected signature manually
    const { createHmac } = require("crypto");
    const expected = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
    expect(svc.verifySignature(payload, expected, secret)).toBe(true);
  });

  it("returns false for a tampered payload", () => {
    const secret = "my-secret";
    const originalPayload = '{"event":"test"}';
    const tamperedPayload = '{"event":"tampered"}';
    const { createHmac } = require("crypto");
    const sig = `sha256=${createHmac("sha256", secret).update(originalPayload).digest("hex")}`;
    expect(svc.verifySignature(tamperedPayload, sig, secret)).toBe(false);
  });

  it("returns false for a wrong secret", () => {
    const payload = '{"event":"test"}';
    const { createHmac } = require("crypto");
    const sig = `sha256=${createHmac("sha256", "correct-secret").update(payload).digest("hex")}`;
    expect(svc.verifySignature(payload, sig, "wrong-secret")).toBe(false);
  });

  it("returns false when signature length differs", () => {
    expect(svc.verifySignature("payload", "short", "secret")).toBe(false);
  });
});

describe("NotificationService.notify — consecutive_failures tracking (#667)", () => {
  let svc: NotificationService;

  beforeEach(() => {
    svc = new NotificationService();
    mockQuery.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("increments consecutive_failures on delivery failure", async () => {
    const webhookRow = {
      id: 1,
      url: "https://example.com/hook",
      events: ["deposit"],
      secret: null,
      consecutive_failures: 0,
    };

    // SELECT webhooks returns one webhook
    mockQuery.mockResolvedValueOnce([webhookRow]);

    // fetch returns non-2xx
    (fetch as any).mockResolvedValueOnce({ ok: false, status: 500 } as Response);

    // Mock validateWebhookUrl to succeed (no DNS calls in unit test)
    const notifMod = await import("./notifications.js");
    vi.spyOn(notifMod, "validateWebhookUrl").mockResolvedValue(undefined);

    // UPDATE consecutive_failures
    mockQuery.mockResolvedValueOnce([]);
    // INSERT webhook_deliveries
    mockQuery.mockResolvedValueOnce([]);

    await svc.notify("deposit", { amount: 100 });

    // The second query call should be the UPDATE for consecutive_failures = 1
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("consecutive_failures"),
      [1, 1],
    );
  });

  it("resets consecutive_failures to 0 on success", async () => {
    const webhookRow = {
      id: 2,
      url: "https://example.com/hook",
      events: ["deposit"],
      secret: null,
      consecutive_failures: 5,
    };

    mockQuery.mockResolvedValueOnce([webhookRow]);

    // fetch succeeds
    (fetch as any).mockResolvedValueOnce({ ok: true, status: 200 } as Response);

    const notifMod = await import("./notifications.js");
    vi.spyOn(notifMod, "validateWebhookUrl").mockResolvedValue(undefined);

    // UPDATE consecutive_failures = 0
    mockQuery.mockResolvedValueOnce([]);

    await svc.notify("deposit", { amount: 50 });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("consecutive_failures = 0"),
      [2],
    );
  });

  it("auto-deactivates webhook after 10 consecutive failures", async () => {
    const webhookRow = {
      id: 3,
      url: "https://example.com/hook",
      events: ["deposit"],
      secret: null,
      consecutive_failures: 9, // one more will reach 10
    };

    mockQuery.mockResolvedValueOnce([webhookRow]);

    (fetch as any).mockResolvedValueOnce({ ok: false, status: 500 } as Response);

    const notifMod = await import("./notifications.js");
    vi.spyOn(notifMod, "validateWebhookUrl").mockResolvedValue(undefined);

    // UPDATE with active = FALSE
    mockQuery.mockResolvedValueOnce([]);
    // INSERT webhook_deliveries
    mockQuery.mockResolvedValueOnce([]);

    await svc.notify("deposit", {});

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("active = FALSE"),
      [10, 3],
    );
  });
});

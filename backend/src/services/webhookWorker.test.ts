import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/index.js", () => ({
  query: vi.fn(),
}));

vi.mock("../logger.js", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("./sse.js", () => ({
  sseService: {
    broadcastWebhookDelivery: vi.fn(),
  },
}));

import { query } from "../db/index.js";

const mockQuery = query as ReturnType<typeof vi.fn>;

function makeBossMock() {
  return { send: vi.fn() } as any;
}

describe("processWebhookDelivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("increments consecutive_failures on delivery failure", async () => {
    const { processWebhookDelivery } = await import("./webhookWorker.js");
    const notifMod = await import("./notifications.js");
    vi.spyOn(notifMod, "validateWebhookUrl").mockResolvedValue(undefined);

    mockQuery.mockResolvedValueOnce([
      { id: 1, url: "https://example.com/hook", events: ["deposit"], secret: null, consecutive_failures: 0 },
    ]);

    (fetch as any).mockResolvedValueOnce({ ok: false, status: 500, statusText: "Internal Server Error" });

    const boss = makeBossMock();
    await processWebhookDelivery(boss, 1, '{"event":"deposit"}');

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("consecutive_failures = $1"),
      [1, 1],
    );
  });

  it("resets consecutive_failures to 0 on success", async () => {
    const { processWebhookDelivery } = await import("./webhookWorker.js");
    const notifMod = await import("./notifications.js");
    vi.spyOn(notifMod, "validateWebhookUrl").mockResolvedValue(undefined);

    mockQuery.mockResolvedValueOnce([
      { id: 2, url: "https://example.com/hook", events: ["deposit"], secret: null, consecutive_failures: 5 },
    ]);

    (fetch as any).mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK" });

    const boss = makeBossMock();
    await processWebhookDelivery(boss, 2, '{"event":"deposit"}');

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("consecutive_failures = 0"),
      [2],
    );
  });

  it("auto-deactivates webhook after 10 consecutive failures", async () => {
    const { processWebhookDelivery } = await import("./webhookWorker.js");
    const notifMod = await import("./notifications.js");
    vi.spyOn(notifMod, "validateWebhookUrl").mockResolvedValue(undefined);

    mockQuery.mockResolvedValueOnce([
      { id: 3, url: "https://example.com/hook", events: ["deposit"], secret: null, consecutive_failures: 9 },
    ]);

    (fetch as any).mockResolvedValueOnce({ ok: false, status: 500, statusText: "Internal Server Error" });

    const boss = makeBossMock();
    await processWebhookDelivery(boss, 3, '{"event":"deposit"}');

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("active = FALSE"),
      [10, 3],
    );
  });

  it("broadcasts via SSE on delivery success", async () => {
    const { processWebhookDelivery } = await import("./webhookWorker.js");
    const notifMod = await import("./notifications.js");
    vi.spyOn(notifMod, "validateWebhookUrl").mockResolvedValue(undefined);

    mockQuery.mockResolvedValueOnce([
      { id: 4, url: "https://example.com/hook", events: ["deposit"], secret: null, consecutive_failures: 0 },
    ]);

    (fetch as any).mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK" });

    const boss = makeBossMock();
    await processWebhookDelivery(boss, 4, '{"event":"deposit"}');

    const { sseService } = await import("./sse.js");
    expect(sseService.broadcastWebhookDelivery).toHaveBeenCalledWith(4, {
      type: "delivery",
      attempt: 1,
      statusCode: 200,
      durationMs: expect.any(Number),
      success: true,
    });
  });

  it("returns early when webhook not found", async () => {
    const { processWebhookDelivery } = await import("./webhookWorker.js");

    mockQuery.mockResolvedValueOnce([]);

    const boss = makeBossMock();
    await processWebhookDelivery(boss, 999, '{"event":"deposit"}');

    expect(fetch).not.toHaveBeenCalled();
  });
});

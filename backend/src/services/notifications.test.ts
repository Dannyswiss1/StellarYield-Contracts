import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../db/index.js", () => ({ query: vi.fn() }));
vi.mock("../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

async function getTestContext() {
  const { query } = await import("../db/index.js");
  const { logger } = await import("../logger.js");
  const { NotificationService } = await import("./notifications.js");
  return {
    query: query as ReturnType<typeof vi.fn>,
    logger: logger as unknown as { warn: ReturnType<typeof vi.fn> },
    service: new NotificationService(),
  };
}

describe("NotificationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("notify", () => {
    it("does nothing when no webhooks match the event", async () => {
      const { query, service } = await getTestContext();
      query.mockResolvedValue([]);

      const fetchSpy = vi.spyOn(globalThis, "fetch");
      await service.notify("deposit", { amount: "100" });

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("POSTs JSON payload to matching webhook URLs", async () => {
      const { query, service } = await getTestContext();
      query.mockResolvedValue([
        { id: 1, url: "https://example.com/hook", events: ["deposit"], secret: null },
      ]);

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, { status: 200 }),
      );

      await service.notify("deposit", { amount: "100" });

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://example.com/hook");
      expect(init?.method).toBe("POST");

      const body = JSON.parse(init?.body as string);
      expect(body.event).toBe("deposit");
      expect(body.data).toEqual({ amount: "100" });
      expect(body).toHaveProperty("timestamp");
    });

    it("adds HMAC-SHA256 signature header when secret is set", async () => {
      const { query, service } = await getTestContext();
      query.mockResolvedValue([
        { id: 1, url: "https://example.com/hook", events: ["deposit"], secret: "mysecret" },
      ]);

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, { status: 200 }),
      );

      await service.notify("deposit", { amount: "50" });

      const [, init] = fetchSpy.mock.calls[0];
      const headers = init?.headers as Record<string, string>;
      expect(headers["X-StellarYield-Signature"]).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it("omits signature header when no secret is set", async () => {
      const { query, service } = await getTestContext();
      query.mockResolvedValue([
        { id: 1, url: "https://example.com/hook", events: ["deposit"], secret: null },
      ]);

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, { status: 200 }),
      );

      await service.notify("deposit", {});

      const [, init] = fetchSpy.mock.calls[0];
      const headers = init?.headers as Record<string, string>;
      expect(headers).not.toHaveProperty("X-StellarYield-Signature");
    });

    it("logs a warning on non-2xx response, does not throw", async () => {
      const { query, logger, service } = await getTestContext();
      query.mockResolvedValue([
        { id: 1, url: "https://example.com/hook", events: ["deposit"], secret: null },
      ]);

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, { status: 500 }),
      );

      await expect(service.notify("deposit", {})).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });

    it("logs a warning on network error, does not throw", async () => {
      const { query, logger, service } = await getTestContext();
      query.mockResolvedValue([
        { id: 1, url: "https://example.com/hook", events: ["deposit"], secret: null },
      ]);

      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network error"));

      await expect(service.notify("deposit", {})).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });

    it("delivers to all webhooks even if one fails", async () => {
      const { query, service } = await getTestContext();
      query.mockResolvedValue([
        { id: 1, url: "https://ok.com/hook", events: ["deposit"], secret: null },
        { id: 2, url: "https://fail.com/hook", events: ["deposit"], secret: null },
      ]);

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
        if (String(url).includes("fail")) return Promise.reject(new Error("timeout"));
        return Promise.resolve(new Response(null, { status: 200 }));
      });

      await expect(service.notify("deposit", {})).resolves.toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("registerWebhook", () => {
    it("inserts a webhook row into the database", async () => {
      const { query, service } = await getTestContext();
      query.mockResolvedValue([]);

      await service.registerWebhook("https://example.com/hook", ["deposit"], "secret123");

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO webhooks"),
        ["https://example.com/hook", ["deposit"], "secret123"],
      );
    });

    it("uses null when no secret is provided", async () => {
      const { query, service } = await getTestContext();
      query.mockResolvedValue([]);

      await service.registerWebhook("https://example.com/hook", ["vault_created"]);

      expect(query).toHaveBeenCalledWith(
        expect.any(String),
        ["https://example.com/hook", ["vault_created"], null],
      );
    });
  });
});

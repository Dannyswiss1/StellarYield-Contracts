import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

// Mock the database layer and the notification service so the HTTP stack runs
// end-to-end (routing, auth, validation, controllers) without a real DB,
// outbound DNS lookups, or network calls.
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  validateWebhookUrl: vi.fn(),
}));

vi.mock("../../db/index.js", () => ({
  query: mocks.query,
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock("../../services/notifications.js", () => ({
  validateWebhookUrl: mocks.validateWebhookUrl,
  NotificationService: vi.fn(() => ({
    testDeliver: vi.fn(),
    verifySignature: vi.fn(),
  })),
}));

import { webhooksRouter } from "../routes/webhooks.js";
import { errorHandler } from "../middleware/errors.js";

// Mount the real webhooks router (auth + validation + controllers) on a
// minimal app, mirroring how app.ts wires it under /api/v1/webhooks.
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/webhooks", webhooksRouter);
  app.use(errorHandler);
  return app;
}

const request = supertest(buildApp());

const AUTH = "Bearer test-admin-key";
const API_KEY_ROW = { id: 1, role: "admin", label: "test" };

/**
 * Routes the shared `query` mock by SQL so each call (auth lookup vs. the
 * controller's own query) gets the right response regardless of order.
 */
function routeQuery(handlers: {
  apiKey?: unknown[];
  webhooks?: unknown[] | (() => unknown[]);
}) {
  mocks.query.mockImplementation((sql: string) => {
    if (sql.includes("api_keys")) {
      return Promise.resolve(handlers.apiKey ?? [API_KEY_ROW]);
    }
    const webhooks = handlers.webhooks ?? [];
    return Promise.resolve(typeof webhooks === "function" ? webhooks() : webhooks);
  });
}

describe("Webhook registration endpoints (#690)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateWebhookUrl.mockResolvedValue(undefined);
  });

  describe("POST /api/v1/webhooks", () => {
    it("creates a webhook and returns 201 for a valid body", async () => {
      const created = {
        id: 1,
        url: "https://example.com/hook",
        events: ["deposit"],
        active: true,
        created_at: new Date("2024-01-01T00:00:00.000Z"),
        consecutive_failures: 0,
      };
      routeQuery({ webhooks: [created] });

      const res = await request
        .post("/api/v1/webhooks")
        .set("Authorization", AUTH)
        .send({ url: "https://example.com/hook", events: ["deposit"] });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: 1,
        url: "https://example.com/hook",
        events: ["deposit"],
        active: true,
      });
    });

    it("returns 400 when the URL is not HTTPS", async () => {
      routeQuery({});

      const res = await request
        .post("/api/v1/webhooks")
        .set("Authorization", AUTH)
        .send({ url: "http://example.com/hook", events: ["deposit"] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("ValidationError");
      // Validation must reject before the controller inserts anything.
      expect(mocks.query).not.toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO webhooks"),
        expect.anything(),
      );
    });

    it("returns 400 when the events array is missing", async () => {
      routeQuery({});

      const res = await request
        .post("/api/v1/webhooks")
        .set("Authorization", AUTH)
        .send({ url: "https://example.com/hook" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("ValidationError");
    });

    it("returns 400 when the events array is empty", async () => {
      routeQuery({});

      const res = await request
        .post("/api/v1/webhooks")
        .set("Authorization", AUTH)
        .send({ url: "https://example.com/hook", events: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("ValidationError");
    });

    it("returns 401 when no Authorization header is sent", async () => {
      routeQuery({});

      const res = await request
        .post("/api/v1/webhooks")
        .send({ url: "https://example.com/hook", events: ["deposit"] });

      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/v1/webhooks", () => {
    it("returns 401 without authentication", async () => {
      routeQuery({});

      const res = await request.get("/api/v1/webhooks");

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ error: "Unauthorized" });
    });

    it("returns 200 and an array of webhooks with valid auth", async () => {
      routeQuery({
        webhooks: [
          {
            id: 1,
            url: "https://a.com/hook",
            events: ["deposit"],
            active: true,
            created_at: new Date("2024-01-01T00:00:00.000Z"),
            consecutive_failures: 0,
          },
          {
            id: 2,
            url: "https://b.com/hook",
            events: ["vault_created"],
            active: true,
            created_at: new Date("2024-01-02T00:00:00.000Z"),
            consecutive_failures: 0,
          },
        ],
      });

      const res = await request.get("/api/v1/webhooks").set("Authorization", AUTH);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
      expect(res.body[0]).toMatchObject({ id: 1, url: "https://a.com/hook" });
      // Secrets must never be exposed in the listing.
      res.body.forEach((w: Record<string, unknown>) => {
        expect(w).not.toHaveProperty("secret");
      });
    });

    it("returns 200 and an empty array when there are no webhooks", async () => {
      routeQuery({ webhooks: [] });

      const res = await request.get("/api/v1/webhooks").set("Authorization", AUTH);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe("DELETE /api/v1/webhooks/:id", () => {
    it("returns 404 when the webhook does not exist", async () => {
      routeQuery({ webhooks: [] });

      const res = await request
        .delete("/api/v1/webhooks/999")
        .set("Authorization", AUTH);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: "NotFound" });
    });

    it("returns 204 on successful deletion", async () => {
      routeQuery({ webhooks: [{ id: 5 }] });

      const res = await request
        .delete("/api/v1/webhooks/5")
        .set("Authorization", AUTH);

      expect(res.status).toBe(204);
      expect(res.body).toEqual({});
    });

    it("returns 400 for a non-numeric id (param validation)", async () => {
      routeQuery({});

      const res = await request
        .delete("/api/v1/webhooks/not-a-number")
        .set("Authorization", AUTH);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("ValidationError");
    });

    it("returns 401 without authentication", async () => {
      routeQuery({});

      const res = await request.delete("/api/v1/webhooks/5");

      expect(res.status).toBe(401);
    });
  });
});

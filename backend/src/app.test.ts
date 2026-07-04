import { describe, it, expect, vi, beforeAll } from "vitest";

vi.mock("./db/index.js", () => ({
  query: vi.fn().mockResolvedValue([]),
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));
vi.mock("pino-http", () => ({ pinoHttp: () => (_req: any, _res: any, next: any) => next() }));

import { createApp } from "./app.js";

const app = createApp();

describe("Security headers (helmet) - #524", () => {
  beforeAll(() => {
    // ensure pool mock is in place before requests
  });

  it("GET /health returns X-Content-Type-Options: nosniff", async () => {
    const { default: supertest } = await import("supertest");
    const res = await supertest(app).get("/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("GET /health returns X-Frame-Options: SAMEORIGIN or DENY", async () => {
    const { default: supertest } = await import("supertest");
    const res = await supertest(app).get("/health");
    // helmet sets SAMEORIGIN by default; both satisfy the security requirement
    expect(res.headers["x-frame-options"]).toMatch(/SAMEORIGIN|DENY/);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../logger.js", () => ({
  logger: {
    child: vi.fn((bindings: Record<string, unknown>) => ({ bindings })),
  },
}));

import { requestId } from "./requestId.js";
import { logger } from "../../logger.js";

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeReqRes() {
  const req = {} as any;
  const res = { setHeader: vi.fn() } as any;
  const next = vi.fn();
  return { req, res, next };
}

describe("requestId middleware (#694)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets an X-Request-ID header matching UUID v4 format", () => {
    const { req, res, next } = makeReqRes();

    requestId(req, res, next);

    expect(req.requestId).toMatch(UUID_V4_REGEX);
    expect(res.setHeader).toHaveBeenCalledWith("X-Request-ID", req.requestId);
    expect(next).toHaveBeenCalledOnce();
  });

  it("attaches the requestId to the pino logger for the request", () => {
    const { req, res, next } = makeReqRes();

    requestId(req, res, next);

    expect(logger.child).toHaveBeenCalledWith({ requestId: req.requestId });
    expect(req.log).toBeDefined();
  });

  it("assigns different requestIds to two simultaneous requests", () => {
    const first = makeReqRes();
    const second = makeReqRes();

    requestId(first.req, first.res, first.next);
    requestId(second.req, second.res, second.next);

    expect(first.req.requestId).toMatch(UUID_V4_REGEX);
    expect(second.req.requestId).toMatch(UUID_V4_REGEX);
    expect(first.req.requestId).not.toBe(second.req.requestId);
  });
});

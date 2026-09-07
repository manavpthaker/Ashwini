import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ principal: vi.fn(), handle: vi.fn(), db: vi.fn() }));
vi.mock("@/server/auth", () => ({ currentPrincipal: mocks.principal }));
vi.mock("@/server/db/client", () => ({ db: mocks.db }));
vi.mock("@/server/env", () => ({ env: () => ({ ASHWINI_TIME_ZONE: "UTC" }) }));
vi.mock("@/server/advisor-service", () => ({
  handleUtterance: mocks.handle,
  IdempotencyConflictError: class extends Error {},
  CorrectionTargetError: class extends Error {},
}));

import { GET, POST } from "@/app/api/conversation/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.principal.mockResolvedValue({ userId: "synthetic-owner" });
});
afterEach(() => vi.restoreAllMocks());

describe("private check-in failure reporting", () => {
  it.each(["read", "write"] as const)("does not log private %s error contents", async (mode) => {
    const error = Object.assign(new Error("synthetic private check-in and provider secret"), {
      detail: "synthetic health parameter",
      query: "synthetic query containing private values",
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.handle.mockRejectedValue(error);
    mocks.db.mockImplementation(() => {
      throw error;
    });
    const response =
      mode === "read"
        ? await GET(new Request("https://ashwini.test/api/conversation"))
        : await POST(
            new Request("https://ashwini.test/api/conversation", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ text: "Synthetic check-in" }),
            }),
          );
    expect(response.status).toBe(503);
    expect(log).toHaveBeenCalledExactlyOnceWith(
      mode === "read" ? "ashwini.checkin.history_failed" : "ashwini.checkin.write_failed",
    );
    expect(await response.text()).not.toMatch(/synthetic|secret|parameter|query/i);
  });
});

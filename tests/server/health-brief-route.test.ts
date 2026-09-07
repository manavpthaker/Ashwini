import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  principal: vi.fn(),
  history: vi.fn(),
  observations: vi.fn(),
  env: vi.fn(),
}));
vi.mock("@/server/auth", () => ({ currentPrincipal: mocks.principal }));
vi.mock("@/server/context", () => ({
  buildHealthHistory: mocks.history,
  buildHealthObservationContext: mocks.observations,
}));
vi.mock("@/server/env", () => ({ env: mocks.env }));
import { GET } from "@/app/api/health-brief/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.principal.mockResolvedValue({ userId: "synthetic-owner", email: "owner@example.test" });
  mocks.env.mockReturnValue({ ASHWINI_TIME_ZONE: "UTC" });
  mocks.history.mockResolvedValue([]);
  mocks.observations.mockResolvedValue({ healthObservationCoverage: [] });
});

describe("read-only health brief endpoint", () => {
  it("requires the authenticated owner before either context read", async () => {
    mocks.principal.mockResolvedValue(null);
    const response = await GET(new Request("https://ashwini.test/api/health-brief"));
    expect(response.status).toBe(401);
    expect(mocks.history).not.toHaveBeenCalled();
    expect(mocks.observations).not.toHaveBeenCalled();
  });

  it("returns a no-store empty brief without a synthetic profile", async () => {
    const response = await GET(new Request("https://ashwini.test/api/health-brief"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ available: false, context: [], coverage: [] });
    expect(mocks.history).toHaveBeenCalledOnce();
    expect(mocks.observations).toHaveBeenCalledOnce();
  });

  it("does not expose health-bearing errors or turn failure into absence", async () => {
    mocks.observations.mockRejectedValue(new Error("PRIVATE_METRIC_MARKER"));
    const response = await GET(new Request("https://ashwini.test/api/health-brief"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("PRIVATE_METRIC_MARKER");
  });
});

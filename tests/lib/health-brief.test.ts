import { afterEach, describe, expect, it, vi } from "vitest";
import { composeHealthBrief, fetchHealthBrief, type BriefCoverage } from "@/lib/health-brief";
import type { HealthHistoryEntry } from "@/domain/advisor/types";

const history = (overrides: Partial<HealthHistoryEntry> = {}): HealthHistoryEntry => ({
  id: "synthetic-goal",
  category: "goal",
  statement: "Saved goal: preserve muscle during fat loss.",
  sourceLabel: "Synthetic goal history",
  sourceLocator: "Goals",
  sourceDate: "2024-01-01",
  sourceDatePrecision: "year",
  temporalStatus: "historical",
  confirmationRequired: true,
  ...overrides,
});
const coverage = (overrides: Partial<BriefCoverage> = {}): BriefCoverage => ({
  type: "HKCategoryTypeIdentifierSleepAnalysis",
  label: "Recorded sleep",
  latestEndAt: "2024-03-01T12:00:00Z",
  freshness: "historical",
  windowTruncated: false,
  ...overrides,
});
const generatedAt = "2026-09-07T12:00:00Z";
afterEach(() => vi.unstubAllGlobals());

describe("initial source-backed health brief", () => {
  it("appears from imported history without requiring a check-in", () => {
    const brief = composeHealthBrief({ history: [history()], coverage: [coverage()], generatedAt });
    expect(brief.available).toBe(true);
    expect(brief.headline).toContain("training goal");
    expect(brief.nextStep).toContain("If you feel under-recovered");
    expect(brief.summary).toContain("cannot tell us how you slept last night");
    expect(brief.context[0]?.sourceDatePrecision).toBe("year");
    expect(brief.coverage[0]?.latestEndAt).toBe("2024-03-01T12:00:00Z");
    expect(brief.limitation).toContain("not a clinical assessment");
  });

  it("never promotes historical medications or prescriptions into brief instructions", () => {
    const brief = composeHealthBrief({
      history: [
        history({
          category: "medication_history",
          statement: "Synthetic historical prescription order.",
        }),
      ],
      coverage: [],
      generatedAt,
    });
    expect(brief.available).toBe(true);
    expect(brief.context).toHaveLength(0);
    expect(JSON.stringify(brief)).not.toContain("Synthetic historical prescription order");
    expect(brief.nextStep).not.toMatch(/take|dose|prescription/i);
  });

  it("keeps missing metrics unknown rather than turning export date into sample freshness", () => {
    const brief = composeHealthBrief({
      history: [history()],
      coverage: [coverage({ latestEndAt: null, freshness: "missing" })],
      generatedAt,
    });
    expect(brief.coverage[0]?.latestEndAt).toBeNull();
    expect(brief.coverage[0]?.freshness).toBe("missing");
    expect(brief.summary).toContain("older or incomplete");
  });

  it("does not diagnose recovery from recent sleep data", () => {
    const brief = composeHealthBrief({
      history: [history()],
      coverage: [
        coverage({ latestEndAt: generatedAt, freshness: "recent", windowTruncated: true }),
      ],
      generatedAt,
    });
    expect(brief.summary).toContain("cannot establish how rested you feel");
    expect(brief.coverage[0]?.windowTruncated).toBe(true);
  });

  it("shows no fabricated context when nothing is imported", () => {
    const brief = composeHealthBrief({
      history: [],
      coverage: [coverage({ latestEndAt: null, freshness: "missing" })],
      generatedAt,
    });
    expect(brief.available).toBe(false);
    expect(brief.context).toEqual([]);
    expect(brief.summary).toContain("no imported health context");
  });

  it("works for wearable-only imports and caps source excerpts", () => {
    const wearable = composeHealthBrief({ history: [], coverage: [coverage()], generatedAt });
    expect(wearable.available).toBe(true);
    const brief = composeHealthBrief({
      history: [
        history(),
        history({ id: "other", category: "preference" }),
        history({ id: "extra" }),
      ],
      coverage: [],
      generatedAt,
    });
    expect(brief.context).toHaveLength(2);
  });

  it("uses a private GET with a deadline, never a POST or a model request", async () => {
    const fixture = composeHealthBrief({ history: [], coverage: [], generatedAt });
    const fetch = vi.fn().mockResolvedValue(Response.json(fixture));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchHealthBrief()).toEqual(fixture);
    expect(fetch).toHaveBeenCalledWith(
      "/api/health-brief",
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
    );
    expect(fetch.mock.calls[0]?.[1].method).toBeUndefined();
  });

  it("fails explicitly on a read error instead of returning an empty brief", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    await expect(fetchHealthBrief()).rejects.toThrow("could not be refreshed");
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  createContextualAdvisor,
  modelConfigured,
  selectHealthHistory,
} from "@/server/contextual-advisor";
import type { AdvisorInput } from "@/domain/advisor";
import type { HealthHistoryEntry } from "@/domain/advisor/types";

const input: AdvisorInput = {
  now: new Date("2026-09-06T16:00:00Z"),
  utterance: { text: "I slept poorly and feel tired before training", attachments: [] },
  context: {
    mealsToday: [],
    commitments: [],
    activeRoutines: [],
    medications: [],
    supplements: [],
    interactionResults: [],
    confoundDefinitions: [],
    confoundEvaluations: [],
    healthHistory: [
      {
        id: "old-sleep",
        category: "sleep",
        statement: "Earlier plan used a consistent wind-down routine.",
        sourceLabel: "Synthetic historical plan",
        sourceLocator: "private-example.md#sleep",
        sourceDate: null,
        temporalStatus: "historical",
        confirmationRequired: true,
      },
    ],
    recentCheckins: [
      { id: "recent", text: "Late work yesterday", at: new Date("2026-09-05T21:00:00Z") },
    ],
  },
};
const config = { consent: true, apiKey: "synthetic-secret", model: "test-model" };
const synthesis = {
  scope: "lifestyle",
  domain: "training",
  understanding: "Your current sleep report may make a demanding session less appealing.",
  hypotheses: [
    {
      explanation: "Short sleep is a plausible contributor.",
      alternative: "Workload or another unmeasured factor could also contribute.",
    },
  ],
  nextStep: "Keep today's activity easy and reassess after rest.",
  uncertainty: "This is a working hypothesis, not a measured personal pattern.",
  followUp: "How much sleep did you get?",
  contextIds: ["old-sleep", "recent"],
  articleIds: ["12345"],
  clinicalRoute: null,
};
const research = vi.fn(async () => ({
  status: "retrieved" as const,
  checkedAt: input.now.toISOString(),
  sourceId: "literature",
  articles: [
    {
      id: "12345",
      title: "Synthetic sleep review",
      year: "2025",
      publicationTypes: ["Review"],
      abstract: "Synthetic abstract for testing only.",
      url: "https://pubmed.ncbi.nlm.nih.gov/12345/",
    },
  ],
}));
const modelResponse = (value: unknown) =>
  new Response(
    JSON.stringify({
      status: "completed",
      output: [
        { type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] },
      ],
    }),
  );

describe("context-aware advisor", () => {
  it("requires explicit processor consent, a key and model", () => {
    expect(modelConfigured(config)).toBe(true);
    expect(modelConfigured({ ...config, consent: false })).toBe(false);
    expect(modelConfigured({ consent: true })).toBe(false);
    expect(modelConfigured({ consent: true, apiKey: "x" })).toBe(false);
  });
  it("makes imported history visible in rules-only mode without external requests", async () => {
    const fetcher = vi.fn();
    const lookup = vi.fn();
    const result = await createContextualAdvisor(
      { ...config, consent: false },
      { fetcher, research: lookup },
    ).respond(input);
    expect(result.reply.text).toContain("Earlier plan");
    expect(result.reply.text).toContain("historical; date unknown");
    expect(result.decisions[0]?.sources).toContainEqual({
      table: "health_context_entries",
      id: "old-sleep",
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });
  it("uses history and genuine supplied references for a provisional synthesis", async () => {
    const fetcher = vi.fn(async () => modelResponse(synthesis));
    const result = await createContextualAdvisor(config, { fetcher, research }).respond(input);
    expect(result.decisions[0]).toMatchObject({
      evidenceStatus: "working_hypothesis",
      ladderLevel: 3,
      gateOutcome: "caveated",
    });
    expect(result.decisions[0]?.sources).toEqual([
      { table: "health_context_entries", id: "old-sleep" },
      { table: "messages", id: "recent" },
      { table: "external_results", id: "literature" },
    ]);
    const options = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const sent = JSON.parse(String(options[1].body));
    expect(sent.store).toBe(false);
    expect(sent.input).toContain("historical");
    expect(sent.input).not.toContain("private-example.md");
    expect(sent.tools).toBeUndefined(); // No model-generated private searches.
    expect(result.reply.text).toContain("https://pubmed.ncbi.nlm.nih.gov/12345/");
  });
  it.each([
    "I have crushing chest pain",
    "I talked to my therapist about my private session",
    "I have diabetes and what should I eat before training?",
    "Should I add creatine?",
  ])("keeps terminal safety ahead of every outbound call: %s", async (text) => {
    const fetcher = vi.fn();
    const lookup = vi.fn();
    const result = await createContextualAdvisor(config, { fetcher, research: lookup }).respond({
      ...input,
      utterance: { text, attachments: [] },
    });
    expect(result.trace.ruleId).not.toBe("contextual-synthesis");
    expect(fetcher).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });
  it.each([
    { ...synthesis, contextIds: ["invented"] },
    { ...synthesis, articleIds: ["invented"] },
    { ...synthesis, scope: "clinical" },
    { invalid: true },
  ])("rejects unsupported sources and malformed outputs", async (value) => {
    const result = await createContextualAdvisor(config, {
      fetcher: vi.fn(async () => modelResponse(value)),
      research,
    }).respond(input);
    expect(result.trace.ruleId).not.toBe("contextual-synthesis");
    expect(result.reply.text).toContain("temporarily unavailable");
  });
  it("routes clinical model results instead of labeling them lifestyle guidance", async () => {
    const result = await createContextualAdvisor(config, {
      fetcher: vi.fn(async () =>
        modelResponse({ ...synthesis, scope: "clinical", clinicalRoute: "clinician" }),
      ),
      research,
    }).respond(input);
    expect(result.route).toBe("clinician");
    expect(result.decisions[0]).toMatchObject({ evidenceStatus: "route_out", ladderLevel: 5 });
  });
  it("removes protected historical check-ins before the provider request", async () => {
    const fetcher = vi.fn(async () =>
      modelResponse({ ...synthesis, contextIds: [], articleIds: [] }),
    );
    await createContextualAdvisor(config, { fetcher }).respond({
      ...input,
      context: {
        ...input.context,
        recentCheckins: [
          { id: "protected", text: "My therapist told me private things", at: input.now },
        ],
      },
    });
    const options = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(options[1].body)).not.toContain("private things");
  });
  it("falls back on network failure without exposing provider errors", async () => {
    const result = await createContextualAdvisor(config, {
      fetcher: vi.fn(async () => {
        throw new Error("private-secret-content");
      }),
      research,
    }).respond(input);
    expect(result.reply.text).not.toContain("private-secret-content");
    expect(result.reply.text).toContain("rules-only");
  });
  it("does not select unrelated historical meal targets for a sleep-only question", () => {
    const entry = input.context.healthHistory![0]!;
    const selected = selectHealthHistory({
      ...input,
      utterance: { text: "I slept badly", attachments: [] },
      context: {
        ...input.context,
        healthHistory: [entry, { ...entry, id: "food", category: "nutrition" }],
      },
    });
    expect(selected.map((item) => item.id)).toEqual(["old-sleep"]);
  });

  it("retrieves relevant last-position facts from 500+ entries independently of source order", () => {
    const clinicalHistory: HealthHistoryEntry[] = Array.from({ length: 550 }, (_, index) => ({
      ...input.context.healthHistory![0]!,
      id: `clinical-${index}`,
      category: index % 2 ? "condition" : "medication_history",
      sourceLabel: "Synthetic clinical archive",
      sourceLocator: `synthetic-resource-${index}`,
      statement: `Synthetic historical entry number ${index}.`,
      sourceDate: "2026-08-01",
    }));
    const relevant: HealthHistoryEntry[] = [
      {
        ...input.context.healthHistory![0]!,
        id: "target-lab",
        category: "measurement",
        sourceLabel: "Synthetic lab archive",
        statement: "Ferritin result was recorded by the laboratory.",
        sourceDate: "2025-02-01",
      },
      {
        ...input.context.healthHistory![0]!,
        id: "personal-plan",
        category: "goal",
        sourceLabel: "Synthetic personal goals",
        statement: "Earlier recovery plan prioritized a consistent bedtime.",
      },
      input.context.healthHistory![0]!,
    ];
    const largeInput = {
      ...input,
      utterance: {
        text: "What do my ferritin and sleep history add to my recovery plan?",
        attachments: [],
      },
      context: { ...input.context, healthHistory: [...clinicalHistory, ...relevant] },
    };
    const selected = selectHealthHistory(largeInput);
    const reversed = selectHealthHistory({
      ...largeInput,
      context: {
        ...largeInput.context,
        healthHistory: [...largeInput.context.healthHistory].reverse(),
      },
    });
    expect(selected).toHaveLength(60);
    expect(selected.map((entry) => entry.id)).toEqual(reversed.map((entry) => entry.id));
    expect(selected.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(relevant.map((entry) => entry.id)),
    );
    expect(new Set(selected.map((entry) => entry.category)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(selected.map((entry) => entry.sourceLabel)).size).toBeGreaterThanOrEqual(4);
  });

  it.each(["I feel fatigue", "I slept poorly", "What is recorded about ferritin?"])(
    "makes dated measurements eligible for %s without interpreting them",
    (text) => {
      const measurement: HealthHistoryEntry = {
        ...input.context.healthHistory![0]!,
        id: "synthetic-lab",
        category: "measurement",
        statement: "Ferritin result recorded on the lab report.",
      };
      const selected = selectHealthHistory({
        ...input,
        utterance: { text, attachments: [] },
        context: { ...input.context, healthHistory: [measurement] },
      });
      expect(selected).toEqual([measurement]);
    },
  );

  it("uses recorded recency only after relevance and does not rank status flags as clinical importance", () => {
    const old: HealthHistoryEntry = {
      ...input.context.healthHistory![0]!,
      id: "old-current-flag",
      sourceDate: "2023-01-01",
      temporalStatus: "current",
      confirmationRequired: false,
    };
    const newer: HealthHistoryEntry = {
      ...old,
      id: "newer-historical",
      sourceDate: "2025-01-01",
      temporalStatus: "historical",
      confirmationRequired: true,
    };
    const unknown: HealthHistoryEntry = {
      ...old,
      id: "unknown-date",
      sourceDate: "2026-01-01",
      sourceDatePrecision: "unknown",
    };
    const selected = selectHealthHistory({
      ...input,
      context: { ...input.context, healthHistory: [old, unknown, newer] },
    });
    expect(selected.map((entry) => entry.id)).toEqual([
      "newer-historical",
      "old-current-flag",
      "unknown-date",
    ]);
  });

  it("labels rules-only mode even when saved history is unrelated to the check-in", async () => {
    const fetcher = vi.fn();
    const result = await createContextualAdvisor({ consent: false }, { fetcher }).respond({
      ...input,
      utterance: { text: "I need help organizing tomorrow", attachments: [] },
    });
    expect(result.reply.text).toContain("model synthesis is not enabled");
    expect(result.reply.receipt).toContain("rules only");
    expect(result.reply.text).not.toContain("Earlier plan");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("surfaces only a bounded dated relevant observation in rules-only mode, never a trend", async () => {
    const observations = [
      {
        id: "synthetic-sleep",
        type: "HKCategoryTypeIdentifierSleepAnalysis",
        unit: null,
        sourceName: "Synthetic wearable",
        device: null,
        latestValue: "HKCategoryValueSleepAnalysisAsleepCore",
        latestStartAt: "2026-09-05T01:00:00Z",
        latestEndAt: "2026-09-05T02:00:00Z",
        samplesInInput: 1,
      },
    ];
    const future = {
      ...observations[0]!,
      id: "future",
      latestValue: "FUTURE_SAMPLE_MARKER",
      latestStartAt: "2027-01-01T01:00:00Z",
      latestEndAt: "2027-01-01T02:00:00Z",
    };
    const result = await createContextualAdvisor({ consent: false }).respond({
      ...input,
      utterance: { text: "I slept poorly", attachments: [] },
      context: {
        ...input.context,
        healthHistory: [],
        healthObservations: [...observations, future],
      },
    });
    expect(result.reply.text).toContain(
      "Recorded sample (Sleep Analysis; 2026-09-05T01:00:00Z to 2026-09-05T02:00:00Z",
    );
    expect(result.reply.text).toContain("HKCategoryValueSleepAnalysisAsleepCore");
    expect(result.reply.text).toContain("not a current value, daily total or trend");
    expect(result.reply.text).toContain("no clinical interpretation is made");
    expect(result.reply.text).toContain("model synthesis is not enabled");
    expect(result.reply.text).not.toContain("FUTURE_SAMPLE_MARKER");
    expect(result.reply.text.match(/Recorded sample/g)).toHaveLength(1);
    expect(result.decisions[0]?.sources).toContainEqual({
      table: "health_observations",
      id: "synthetic-sleep",
    });
  });

  it.each([
    "I have crushing chest pain",
    "My therapist told me something private",
    "Should I add creatine?",
  ])("does not append imported details or change terminal routes for %s", async (text) => {
    const result = await createContextualAdvisor({ consent: false }).respond({
      ...input,
      utterance: { text, attachments: [] },
    });
    expect(result.reply.text).not.toContain("Saved context");
    expect(result.reply.text).not.toContain("model synthesis is not enabled");
    expect(result.reply.text).not.toContain("Recorded sample");
    expect(result.trace.ruleId).not.toBe("contextual-synthesis");
  });

  it.each([
    ["year", "2025"],
    ["month", "2025-01"],
    ["day", "2025-01-01"],
    ["unknown", "date unknown"],
  ] as const)("renders source dates only at %s precision", async (precision, displayed) => {
    const result = await createContextualAdvisor({ consent: false }).respond({
      ...input,
      context: {
        ...input.context,
        healthHistory: [
          {
            ...input.context.healthHistory![0]!,
            sourceDate: "2025-01-01",
            sourceDatePrecision: precision,
          },
        ],
      },
    });
    expect(result.reply.text).toContain(`historical; ${displayed};`);
  });

  it("sends event/capture time separately from reasoning and receipt time", async () => {
    const fetcher = vi.fn(async () =>
      modelResponse({ ...synthesis, contextIds: [], articleIds: [] }),
    );
    const capturedAt = new Date("2025-02-01T12:00:00Z");
    await createContextualAdvisor(config, { fetcher }).respond({ ...input, capturedAt });
    const options = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const sent = JSON.parse(String(options[1].body));
    const projected = JSON.parse(sent.input);
    expect(projected.now).toBe(input.now.toISOString());
    expect(projected.capturedAt).toBe(capturedAt.toISOString());
    expect(sent.instructions).toContain("Anchor relative wording");
  });
});

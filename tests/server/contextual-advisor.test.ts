import { describe, expect, it, vi } from "vitest";
import {
  createContextualAdvisor,
  modelConfigured,
  selectHealthHistory,
} from "@/server/contextual-advisor";
import type { AdvisorInput } from "@/domain/advisor";

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

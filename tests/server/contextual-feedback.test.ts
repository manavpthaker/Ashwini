import { describe, expect, it, vi } from "vitest";
import { createContextualAdvisor, selectHealthHistory } from "@/server/contextual-advisor";
import { resolveCheckinContinuation } from "@/lib/context-feedback";
import type { AdvisorInput, HealthHistoryEntry, HealthMetricSummary } from "@/domain/advisor/types";

const now = new Date("2026-09-07T12:00:00Z");
const base: AdvisorInput = {
  now,
  utterance: { text: "Review my health context", attachments: [] },
  context: {
    healthHistory: [],
    recentCheckins: [],
    mealsToday: [],
    commitments: [],
    activeRoutines: [],
    medications: [],
    supplements: [],
    interactionResults: [],
    confoundDefinitions: [],
    confoundEvaluations: [],
  },
};
const history = (values: Partial<HealthHistoryEntry>): HealthHistoryEntry => ({
  id: "synthetic-history",
  category: "sleep",
  statement: "Earlier plan used a wind-down routine.",
  sourceLabel: "Synthetic fixture",
  sourceLocator: "fixture#source",
  sourceDate: "2025-01-01",
  sourceDatePrecision: "day",
  temporalStatus: "historical",
  confirmationRequired: true,
  ...values,
});
const summary: HealthMetricSummary = {
  id: "summary-opaque",
  type: "HKCategoryTypeIdentifierSleepAnalysis",
  label: "Recorded sleep",
  sourceName: "Synthetic watch",
  sourceKey: "synthetic-device",
  unit: "h",
  date: "2026-06-29",
  periodStartAt: "2026-06-29T01:00:00Z",
  periodEndAt: "2026-06-29T07:00:00Z",
  value: 6,
  sampleCount: 4,
  aggregation: "recorded_duration",
  coverage: "partial",
  freshness: "historical",
  note: "Overlapping recorded sleep intervals were unioned within this source only.",
  sourceIds: ["raw-a", "raw-b"],
};
const ask = (text: string, context: Partial<AdvisorInput["context"]> = {}): AdvisorInput => ({
  ...base,
  utterance: { text, attachments: [] },
  context: { ...base.context, ...context },
});
const rules = () => createContextualAdvisor({ consent: false });
const prior = {
  id: "prior-user",
  text: "What should I eat before training?",
  at: new Date("2026-09-07T11:58:00Z"),
  advisorReply:
    "Timing changes the answer. How long until training starts? Give the time in minutes or hours.",
  advisorMessageId: "prior-advisor",
  advisorAt: new Date("2026-09-07T11:58:10Z"),
};
const modelConfig = { consent: true, model: "test-model", apiKey: "synthetic" };
const modelValue = {
  scope: "lifestyle",
  domain: "body",
  understanding: "The supplied sleep record is historical.",
  hypotheses: [],
  nextStep: "Record the bedtime and wake time for the night in question.",
  uncertainty: "Historical partial coverage cannot establish current sleep.",
  followUp: null,
  contextIds: [summary.id],
  articleIds: [],
  clinicalRoute: null,
};
const modelResponse = (value = modelValue) =>
  new Response(
    JSON.stringify({
      status: "completed",
      output: [
        { type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] },
      ],
    }),
  );

describe("context-aware local acceptance", () => {
  it.each([
    ["What do my labs tell you?", "contextual-labs"],
    ["What should I do to improve my focus?", "contextual-focus"],
    ["What do my sleep records suggest?", "contextual-sleep"],
    ["I ate two eggs for breakfast", "contextual-nutrition"],
    ["Review my health context", "contextual-review"],
  ])("gives one useful next step without a model for %s", async (text, ruleId) => {
    const result = await rules().respond(ask(text));
    expect(result.trace).toMatchObject({ ruleId, mode: "rules_only", reason: "not_configured" });
    expect(result.reply.text).toContain("Next step:");
    expect(result.reply.text).not.toContain("I kept this as context");
    expect(result.decisions[0]).toMatchObject({ evidenceStatus: "rule_based", ladderLevel: 2 });
    expect(result.followUp?.match(/\?/g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(result.reply.text).toContain("not a new research review");
  });

  it("changes the lab review and next step when a dated source-flagged result exists", async () => {
    const text = "What do my labs tell you?";
    const empty = await rules().respond(ask(text));
    const lab = history({
      id: "lab",
      category: "measurement",
      confirmationRequired: false,
      statement:
        "Historical clinical observation: Ferritin [LOINC: 2276-4]: 10 ng/mL. Source reference range: low 20 ng/mL, high 200 ng/mL. Source interpretation: Low [source code: L].",
    });
    const loaded = await rules().respond(ask(text, { healthHistory: [lab] }));
    expect(empty.reply.text).toContain("Add the dated result");
    expect(loaded.reply.text).toContain(
      "1 carry a high, low, abnormal or critical label supplied by the source record",
    );
    expect(loaded.reply.text).toContain("first review items are Ferritin");
    expect(loaded.reply.text).toContain("historical; 2025-01-01");
    expect(loaded.reply.text).toContain("Review the source-flagged result");
    expect(loaded.decisions[0]?.sources).toContainEqual({
      table: "health_context_entries",
      id: "lab",
    });
    expect(loaded.reply.text).not.toMatch(/you (?:have|are) (?:iron deficient|anemic)|take iron/i);
  });

  it("does not independently label a numeric lab result abnormal", async () => {
    const result = await rules().respond(
      ask("Review my labs", {
        healthHistory: [
          history({
            category: "measurement",
            statement: "Historical clinical observation: Ferritin: 10 ng/mL.",
          }),
        ],
      }),
    );
    expect(result.reply.text).toContain("not independently classified");
    expect(result.reply.text).not.toContain("source-flagged result");
  });

  it("retrieves labs from the end of a large clinical archive for a generic lab question", () => {
    const old = Array.from({ length: 500 }, (_, i) =>
      history({
        id: `med-${i}`,
        category: "medication_history",
        statement: `Historical order ${i}.`,
      }),
    );
    const lab = history({
      id: "requested-lab",
      category: "measurement",
      statement: "Historical clinical observation: Ferritin: 10 ng/mL.",
    });
    const selected = selectHealthHistory(
      ask("What do my labs tell you?", { healthHistory: [...old, lab] }),
    );
    expect(selected[0]?.id).toBe("requested-lab");
  });

  it("changes a focus read with attention context without converting history into a diagnosis", async () => {
    const empty = await rules().respond(ask("Help improve my focus"));
    const loaded = await rules().respond(
      ask("Help improve my focus", {
        healthHistory: [
          history({
            category: "condition",
            statement: "Historical attention-related care context, current status unknown.",
          }),
        ],
      }),
    );
    expect(empty.reply.text).toContain("does not establish a measured focus pattern");
    expect(loaded.reply.text).toContain("attention-related history");
    expect(loaded.reply.text).toContain("Current status needs confirmation");
    expect(loaded.reply.text).toContain("15-minute block");
  });

  it("shows historical, partial source-separated sleep data and names the missing current evidence", async () => {
    const result = await rules().respond(
      ask("What do my sleep records suggest?", {
        healthSummaries: [summary],
        healthObservationCoverage: [
          {
            type: summary.type,
            label: "Sleep",
            latestEndAt: summary.periodEndAt,
            freshness: "historical",
            windowTruncated: true,
          },
        ],
      }),
    );
    expect(result.reply.text).toContain("2026-06-29; Synthetic watch): 6 h");
    expect(result.reply.text).toContain("partial coverage");
    expect(result.reply.text).toContain("historical, not a current measurement");
    expect(result.reply.text).toContain(
      "Sleep: latest imported record ends 2026-06-29; historical, not current",
    );
    expect(result.decisions[0]?.sources).toEqual(
      expect.arrayContaining(summary.sourceIds.map((id) => ({ table: "health_observations", id }))),
    );
    expect(result.reply.text).not.toMatch(/last night you slept 6|sleep (?:improved|declined)/i);
  });

  it("ignores future and unrelated summaries instead of turning recent activity into sleep", async () => {
    const result = await rules().respond(
      ask("How can I improve my sleep?", {
        healthSummaries: [
          {
            ...summary,
            type: "HKQuantityTypeIdentifierStepCount",
            label: "PRIVATE_UNRELATED_STEP",
            value: 123456,
          },
          { ...summary, label: "FUTURE_SLEEP", periodEndAt: "2027-01-01T12:00:00Z" },
        ],
      }),
    );
    expect(result.reply.text).not.toContain("PRIVATE_UNRELATED_STEP");
    expect(result.reply.text).not.toContain("FUTURE_SLEEP");
  });

  it("keeps meal extraction exact while giving a practical next step", async () => {
    const result = await rules().respond(ask("I ate two eggs for breakfast"));
    expect(result.records).toEqual([
      { kind: "meal", mealKind: "breakfast", description: "I ate two eggs for breakfast" },
    ]);
    expect(result.reply.text).toContain("real meal");
    expect(result.reply.text).not.toMatch(/\d+\s*(?:calories|kcal|g protein)/);
  });

  it("never promotes historical medication orders or routines to current operations", async () => {
    const result = await rules().respond(
      ask("Review my health context", {
        healthHistory: [
          history({
            category: "medication_history",
            statement: "Historical medication order, not verified current.",
          }),
        ],
      }),
    );
    expect(result.reply.text).toContain("not your current medication list");
    expect(result.reply.text).toContain("No active routine is confirmed");
  });

  it("makes a bounded working hypothesis from a current recovery report and recent sleep self-report", async () => {
    const result = await rules().respond(
      ask("I feel tired today", {
        recentCheckins: [
          {
            id: "recent-sleep",
            text: "I slept poorly",
            at: new Date("2026-09-07T08:00:00Z"),
          },
        ],
      }),
    );
    expect(result.trace.ruleId).toBe("contextual-recovery");
    expect(result.decisions[0]).toMatchObject({
      evidenceStatus: "working_hypothesis",
      ladderLevel: 3,
    });
    expect(result.reply.text).toContain("Sleep may be contributing");
    expect(result.reply.text).toContain("unmeasured factor");
    expect(result.decisions[0]?.sources).toContainEqual({ table: "messages", id: "recent-sleep" });
  });

  it.each([
    ["I slept poorly", "2026-09-01T08:00:00Z"],
    ["I slept poorly", "2026-09-08T08:00:00Z"],
    ["I never had poor sleep", "2026-09-07T08:00:00Z"],
    ["My dad had poor sleep", "2026-09-07T08:00:00Z"],
    ["If I had poor sleep", "2026-09-07T08:00:00Z"],
    ["In an example I slept poorly", "2026-09-07T08:00:00Z"],
    ["I slept poorly. Correction: I slept well last night.", "2026-09-07T08:00:00Z"],
    ["I did not sleep poorly", "2026-09-07T08:00:00Z"],
  ])(
    "does not derive a recovery hypothesis from ineligible prior self-report %s %s",
    async (text, at) => {
      const result = await rules().respond(
        ask("I feel tired today", { recentCheckins: [{ id: "prior", text, at: new Date(at) }] }),
      );
      expect(result.trace.ruleId).not.toBe("contextual-recovery");
    },
  );

  it.each(["I had poor sleep but feel energetic", "Poor sleep", "No fatigue today"])(
    "does not invent a current low-energy report from %s",
    async (text) => {
      const result = await rules().respond(
        ask(text, {
          recentCheckins: [
            { id: "older-sleep", text: "I slept poorly", at: new Date("2026-09-07T08:00:00Z") },
          ],
        }),
      );
      expect(result.trace.ruleId).not.toBe("contextual-recovery");
      expect(result.reply.text).not.toContain("this low-energy report");
    },
  );

  it("does not look through a newer sleep correction for an older poor-sleep report", async () => {
    const result = await rules().respond(
      ask("I feel tired today", {
        recentCheckins: [
          {
            id: "older-sleep",
            text: "I slept poorly",
            at: new Date("2026-09-07T08:00:00Z"),
            receivedAt: new Date("2026-09-07T08:00:00Z"),
          },
          {
            id: "correction",
            text: "Correction: I slept well last night, not poorly.",
            at: new Date("2026-09-07T07:00:00Z"),
            receivedAt: new Date("2026-09-07T10:00:00Z"),
          },
        ],
      }),
    );
    expect(result.trace.ruleId).not.toBe("contextual-recovery");
    expect(result.decisions[0]?.sources).not.toContainEqual({
      table: "messages",
      id: "older-sleep",
    });
  });

  it.each([
    "I have crushing chest pain",
    "Should I add creatine?",
    "My therapist said private things",
  ])("preserves terminal safety for %s", async (text) => {
    const fetcher = vi.fn();
    const research = vi.fn();
    const result = await createContextualAdvisor(modelConfig, { fetcher, research }).respond(
      ask(text, { healthHistory: [history({})] }),
    );
    expect(result.trace.reason).toBe("terminal_rule");
    expect(result.reply.text).not.toContain("Saved context");
    expect(fetcher).not.toHaveBeenCalled();
    expect(research).not.toHaveBeenCalled();
  });
});

describe("ordinary follow-up continuity", () => {
  it("treats a later received delayed check-in as the next exchange, not an old event to skip", () => {
    expect(
      resolveCheckinContinuation(
        ask("In 45 minutes", {
          recentCheckins: [
            { ...prior, receivedAt: new Date("2026-09-07T11:58:00Z") },
            {
              id: "delayed-topic",
              text: "A separate topic from yesterday",
              at: new Date("2026-09-06T11:00:00Z"),
              receivedAt: new Date("2026-09-07T11:59:00Z"),
            },
          ],
        }),
      ),
    ).toBeNull();
  });

  it.each([
    null,
    { id: "protected-turn", receivedAt: new Date("2026-09-07T11:59:00Z"), eligible: false },
    { id: "newer-turn", receivedAt: new Date("2026-09-07T11:59:00Z"), eligible: true },
  ])("does not skip a content-free newest receipt barrier %#", (latestReceiptTurn) => {
    expect(
      resolveCheckinContinuation(
        ask("In 45 minutes", { recentCheckins: [prior], latestReceiptTurn }),
      ),
    ).toBeNull();
  });

  it("continues when the actual latest receipt is the matching eligible prior exchange", () => {
    expect(
      resolveCheckinContinuation(
        ask("In 45 minutes", {
          recentCheckins: [prior],
          latestReceiptTurn: { id: prior.id, receivedAt: prior.at, eligible: true },
        }),
      )?.kind,
    ).toBe("pre_training_timing");
  });
  it.each([
    ["Getting started", "getting started", "two minutes"],
    ["Staying with the task", "staying with the task", "15-minute single-task"],
    ["Mentally tired", "mental energy", "ordinary break"],
  ])(
    "uses the focus answer %s without repeating the question",
    async (text, understanding, nextStep) => {
      const result = await rules().respond(
        ask(text, {
          recentCheckins: [
            {
              ...prior,
              text: "How can I improve my focus?",
              advisorReply:
                "Is the main difficulty getting started, staying with the task, or feeling mentally tired?",
            },
          ],
        }),
      );
      expect(result.trace.ruleId).toBe("contextual-focus");
      expect(result.reply.text).toContain(`difficulty you identified is ${understanding}`);
      expect(result.reply.text).toContain(nextStep);
      expect(result.followUp).toBeNull();
      expect(result.records).toEqual([{ kind: "context_note", text }]);
    },
  );

  it.each(["Sleep", "Energy", "Focus", "Food", "Training"])(
    "carries forward the selected review priority %s",
    async (text) => {
      const result = await rules().respond(
        ask(text, {
          recentCheckins: [
            {
              ...prior,
              text: "Review my health context",
              advisorReply:
                "Which priority should guide the next step: sleep, energy, focus, food or training?",
            },
          ],
        }),
      );
      expect(result.reply.text).toContain("Next step:");
      expect(result.followUp).not.toBe(
        "Which priority should guide the next step: sleep, energy, focus, food or training?",
      );
      expect(result.reply.text).not.toContain("I kept this as context");
      expect(result.records).toEqual([{ kind: "context_note", text }]);
    },
  );

  it("uses a meal-consistency answer without falsely recording a meal occurrence", async () => {
    const result = await rules().respond(
      ask("Lunch", {
        recentCheckins: [
          {
            ...prior,
            text: "Help me make my diet more consistent",
            advisorReply: "Which upcoming meal is hardest to make consistent?",
          },
        ],
      }),
    );
    expect(result.reply.text).toContain("identified lunch");
    expect(result.reply.text).toContain("fallback for lunch");
    expect(result.followUp).toBeNull();
    expect(result.records).toEqual([{ kind: "context_note", text: "Lunch" }]);
  });
  it("uses a direct timing answer as the answer to the prior question", async () => {
    const result = await rules().respond(ask("In 45 minutes", { recentCheckins: [prior] }));
    expect(result.trace.ruleId).toBe("pre-training-nutrition");
    expect(result.reply.text).toContain("45 minutes");
    expect(result.reply.text).not.toContain("How long until training starts?");
    expect(result.decisions[0]?.sources).toEqual(
      expect.arrayContaining([
        { table: "messages", id: "prior-user" },
        { table: "messages", id: "prior-advisor" },
      ]),
    );
    expect(result.records).toEqual([{ kind: "context_note", text: "In 45 minutes" }]);
  });

  it("never replays old symptom wording as the new check-in", async () => {
    const result = await rules().respond(
      ask("In 45 minutes", {
        recentCheckins: [
          {
            ...prior,
            text: "I had chest pain years ago. What should I eat before training?",
          },
        ],
      }),
    );
    expect(result.route).toBeNull();
    expect(result.records).toEqual([{ kind: "context_note", text: "In 45 minutes" }]);
    expect(result.reply.text).not.toContain("chest pain");
  });

  it.each([
    { ...prior, at: new Date("2026-09-06T11:58:00Z") },
    { ...prior, advisorReply: "Which medication was this?" },
    { ...prior, advisorReply: null },
    { ...prior, advisorAt: new Date("2026-09-07T12:10:00Z") },
    { ...prior, text: "My therapist told me private things" },
  ])("does not guess a continuation from stale, protected or unrelated turn %#", (previous) => {
    expect(
      resolveCheckinContinuation(ask("In 45 minutes", { recentCheckins: [previous] })),
    ).toBeNull();
  });

  it("does not skip a newer unrelated check-in to resume an older pending question", () => {
    expect(
      resolveCheckinContinuation(
        ask("In 45 minutes", {
          recentCheckins: [
            prior,
            { id: "newer", text: "A separate topic", at: new Date("2026-09-07T11:59:00Z") },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("does not let a historical delayed capture answer a later advisor question", () => {
    expect(
      resolveCheckinContinuation({
        ...ask("In 45 minutes", { recentCheckins: [prior] }),
        capturedAt: new Date("2026-09-07T11:00:00Z"),
      }),
    ).toBeNull();
  });
});

describe("model context and private diagnostics", () => {
  it("sends the content-free receipt barrier so model continuity cannot silently skip a protected exchange", async () => {
    const fetcher = vi.fn(async () => modelResponse({ ...modelValue, contextIds: [] }));
    const barrier = {
      id: "ineligible-latest",
      receivedAt: new Date("2026-09-07T11:59:00Z"),
      eligible: false,
    };
    await createContextualAdvisor(modelConfig, { fetcher }).respond(
      ask("In 45 minutes", { recentCheckins: [prior], latestReceiptTurn: barrier }),
    );
    const options = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(options[1].body));
    const payload = JSON.parse(body.input);
    expect(payload.continuation).toBeNull();
    expect(payload.context.latestReceiptTurn).toEqual({
      ...barrier,
      receivedAt: barrier.receivedAt.toISOString(),
    });
    expect(body.instructions).toContain(
      "do not attach a short answer to an older advisor question",
    );
  });
  it("bounds provider reference metadata but persists every exact summary contributor", async () => {
    const complete = {
      ...summary,
      sourceIds: Array.from({ length: 12 }, (_, i) => `contributor-${i}`),
    };
    const fetcher = vi.fn(async () => modelResponse());
    const result = await createContextualAdvisor(modelConfig, { fetcher }).respond(
      ask("Review sleep", { healthSummaries: [complete] }),
    );
    const options = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const payload = JSON.parse(JSON.parse(String(options[1].body)).input);
    expect(payload.context.healthSummaries[0].sourceIds).toEqual(complete.sourceIds.slice(0, 8));
    expect(result.decisions[0]?.sources).toEqual(
      complete.sourceIds.map((id) => ({ table: "health_observations", id })),
    );
  });
  it.each(["gpt-6-astra", "test-model"])(
    "uses a low-latency reasoning setting only for the verified supported model %s",
    async (model) => {
      const fetcher = vi.fn(async () => modelResponse());
      await createContextualAdvisor({ ...modelConfig, model }, { fetcher }).respond(
        ask("Review sleep", { healthSummaries: [summary] }),
      );
      const options = fetcher.mock.calls[0] as unknown as [string, RequestInit];
      const body = JSON.parse(String(options[1].body));
      expect(body.reasoning).toEqual(model === "gpt-6-astra" ? { effort: "low" } : undefined);
    },
  );

  it("sends the original answer plus a narrow continuation instead of replacing current self-report", async () => {
    const fetcher = vi.fn(async () => modelResponse({ ...modelValue, contextIds: [] }));
    await createContextualAdvisor(modelConfig, { fetcher }).respond(
      ask("In 45 minutes", {
        recentCheckins: [
          { ...prior, text: "Long ago I had chest pain. What should I eat before training?" },
        ],
      }),
    );
    const options = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const payload = JSON.parse(JSON.parse(String(options[1].body)).input);
    expect(payload.checkin).toBe("In 45 minutes");
    expect(payload.continuation.kind).toBe("pre_training_timing");
    expect(payload.continuation.reasoningText).not.toContain("chest pain");
    expect(payload.context.recentCheckins[0].text).toContain("Long ago");
  });
  it("sends dated summaries, prior replies and explicit coverage; expands summary provenance to raw references", async () => {
    const fetcher = vi.fn(async () => modelResponse());
    const diagnostics = vi.fn();
    const result = await createContextualAdvisor(modelConfig, { fetcher, diagnostics }).respond(
      ask("What do my sleep records suggest?", {
        healthSummaries: [summary],
        recentCheckins: [prior],
      }),
    );
    const options = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(options[1].body));
    const payload = JSON.parse(body.input);
    expect(payload.context.healthSummaries).toEqual([summary]);
    expect(payload.context.recentCheckins[0].advisorReply).toBe(prior.advisorReply);
    expect(result.decisions[0]?.sources).toEqual(
      summary.sourceIds.map((id) => ({ table: "health_observations", id })),
    );
    expect(result.reply.text).toContain(modelValue.uncertainty);
    expect(result.trace.mode).toBe("model");
    expect(diagnostics).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "model", historyEntries: 0, observationSummaries: 1 }),
    );
    expect(body.store).toBe(false);
  });

  it.each([
    [401, "provider_auth"],
    [403, "provider_auth"],
    [429, "provider_rate_limit"],
    [500, "provider_error"],
  ] as const)("reports %s without exposing error bodies", async (status, reason) => {
    const diagnostics = vi.fn();
    const result = await createContextualAdvisor(modelConfig, {
      diagnostics,
      fetcher: vi.fn(async () => new Response("PRIVATE_PROVIDER_BODY", { status })),
    }).respond(ask("Improve my focus"));
    expect(result.trace).toMatchObject({ mode: "model_unavailable", reason });
    expect(result.reply.text).toContain("Next step:");
    expect(result.reply.text).toContain("temporarily unavailable");
    expect(JSON.stringify(diagnostics.mock.calls)).not.toContain("PRIVATE_PROVIDER_BODY");
    expect(JSON.stringify(diagnostics.mock.calls)).not.toContain("Improve my focus");
    expect(result.reply.text).not.toContain("PRIVATE_PROVIDER_BODY");
  });

  it.each([
    ["TimeoutError", "timeout"],
    ["Error", "network"],
  ] as const)("classifies %s without logging message text", async (name, reason) => {
    const diagnostics = vi.fn();
    const result = await createContextualAdvisor(modelConfig, {
      diagnostics,
      fetcher: vi.fn(async () => {
        const error = new Error("PRIVATE_NETWORK_ERROR");
        error.name = name;
        throw error;
      }),
    }).respond(ask("Improve my focus"));
    expect(result.trace.reason).toBe(reason);
    expect(JSON.stringify(diagnostics.mock.calls)).not.toContain("PRIVATE_NETWORK_ERROR");
  });

  it("distinguishes invalid output from invented source references", async () => {
    const invalid = await createContextualAdvisor(modelConfig, {
      fetcher: vi.fn(async () => new Response("not JSON")),
    }).respond(ask("Improve my focus"));
    expect(invalid.trace.reason).toBe("invalid_output");
    const unsupported = await createContextualAdvisor(modelConfig, {
      fetcher: vi.fn(async () => modelResponse()),
    }).respond(ask("Improve my focus"));
    expect(unsupported.trace.reason).toBe("unsupported_provenance");
  });

  it("keeps successful inference even if the metadata logger fails", async () => {
    const result = await createContextualAdvisor(modelConfig, {
      fetcher: vi.fn(async () => modelResponse()),
      diagnostics: () => {
        throw new Error("logger unavailable");
      },
    }).respond(ask("Review sleep", { healthSummaries: [summary] }));
    expect(result.trace.mode).toBe("model");
  });
});

import { describe, expect, it } from "vitest";
import { respondSync, type AdvisorOutput } from "@/domain/advisor";
import { advisorInput, blockingConfound } from "./support";

/**
 * A new owner starts with the confound definitions installed by the migrations
 * and no evaluations, commitments, routines, medications, or prior turns. That
 * state must still produce value without manufacturing personal facts.
 */
const freshRecord = {
  confoundDefinitions: [
    blockingConfound({
      id: "incomplete_source_data",
      label: "Incomplete source data",
      requiredForVerdict: true,
    }),
    blockingConfound({
      id: "adherence_below_threshold",
      label: "Adherence below threshold",
      requiredForVerdict: true,
    }),
  ],
};

function delivers(output: AdvisorOutput): boolean {
  const decision = output.decisions[0];
  return Boolean(
    output.route ||
    output.reply.kind === "question" ||
    (output.reply.kind === "recommendation" && (decision?.target || decision?.choices.length)),
  );
}

describe("first check-in delivery", () => {
  it.each([
    "I ate lunch",
    "Took my morning meds",
    "Slept badly, feeling flat today",
    "My shoulder hurts when I press overhead",
    "What should I eat before training?",
    "I want to get healthier",
    "I have chest pain",
  ])("returns an action, one question, or a route for %s", (text) => {
    expect(delivers(respondSync(advisorInput(text, freshRecord))), text).toBe(true);
  });

  it("asks for the one meal detail that would improve the record without guessing", () => {
    const output = respondSync(advisorInput("I ate lunch", freshRecord));

    expect(output.trace.ruleId).toBe("nutrition");
    expect(output.reply.kind).toBe("question");
    expect(output.reply.text).toMatch(/what did you eat/i);
    expect(output.records).toEqual([{ kind: "meal", mealKind: "lunch", description: null }]);
    expect(output.reply.text).not.toMatch(/\b\d+\s*(?:kcal|calories|g protein)\b/i);
  });

  it("retains stated meal detail instead of claiming it was missing", () => {
    const output = respondSync(advisorInput("I ate eggs and toast for breakfast", freshRecord));

    expect(output.trace.ruleId).toBe("nutrition");
    expect(output.reply.kind).toBe("question");
    expect(output.reply.text).toMatch(/roughly how much/i);
    expect(output.records).toEqual([
      {
        kind: "meal",
        mealKind: "breakfast",
        description: "I ate eggs and toast for breakfast",
      },
    ]);
  });

  it("consumes meal-detail corrections and stops after a plain-language portion", () => {
    const food = respondSync(advisorInput("I ate lunch — chicken salad", freshRecord));
    const portion = respondSync(
      advisorInput("I ate lunch — chicken salad — one bowl", freshRecord),
    );

    expect(food.trace.ruleId).toBe("nutrition");
    expect(food.reply.kind).toBe("question");
    expect(food.reply.text).toMatch(/roughly how much/i);
    expect(food.records).toContainEqual({
      kind: "meal",
      mealKind: "lunch",
      description: "chicken salad",
    });

    expect(portion.trace.ruleId).toBe("nutrition");
    expect(portion.reply.kind).toBe("record");
    expect(portion.reply.text).not.toMatch(/roughly how much|what did you eat/i);
    expect(portion.records).toContainEqual({
      kind: "meal",
      mealKind: "lunch",
      description: "chicken salad — one bowl",
    });
  });

  it("does not mislabel a generic meal time as a food description", () => {
    for (const text of [
      "I had lunch at noon",
      "I ate lunch two hours ago",
      "I had lunch earlier",
    ]) {
      const output = respondSync(advisorInput(text, freshRecord));

      expect(output.trace.ruleId, text).toBe("nutrition");
      expect(output.reply.kind, text).toBe("question");
      expect(output.reply.text, text).toMatch(/what did you eat/i);
      expect(output.reply.text, text).not.toMatch(/foods you named/i);
      expect(output.records, text).toEqual([
        { kind: "meal", mealKind: "lunch", description: null },
      ]);
    }
  });

  it("turns a fresh recovery signal into a conservative same-day choice", () => {
    const output = respondSync(advisorInput("Slept badly, feeling flat today", freshRecord));
    const decision = output.decisions[0];

    expect(output.trace.ruleId).toBe("training-volume");
    expect(output.reply.kind).toBe("recommendation");
    expect(decision).toMatchObject({
      evidenceStatus: "rule_based",
      ladderLevel: 2,
      gateOutcome: "caveated",
    });
    expect(decision?.choices).toContain("Keep optional effort flexible today");
    expect(output.records).toContainEqual({
      kind: "context_note",
      text: "Slept badly, feeling flat today",
    });
  });

  it("keeps low-risk painful-movement guidance available on a fresh record", () => {
    const output = respondSync(
      advisorInput("My shoulder hurts when I press overhead", freshRecord),
    );

    expect(output.trace.ruleId).toBe("symptom-msk");
    expect(output.reply.kind).toBe("recommendation");
    expect(output.reply.text).toMatch(/avoid loading the painful movement/i);
    expect(output.decisions[0]).toMatchObject({
      evidenceStatus: "rule_based",
      gateOutcome: "caveated",
    });
  });

  it("handles a pre-training food question without inventing a meal occurrence", () => {
    const output = respondSync(advisorInput("What should I eat before training?", freshRecord));

    expect(output.trace.ruleId).toBe("pre-training-nutrition");
    expect(output.reply.kind).toBe("question");
    expect(output.reply.text).toMatch(/how long until training/i);
    expect(output.reply.text).not.toMatch(/carbohydrate source|some protein/i);
    expect(output.records.some((record) => record.kind === "meal")).toBe(false);
    expect(output.decisions[0]).toMatchObject({
      evidenceStatus: "rule_based",
      ladderLevel: 2,
      gateOutcome: "caveated",
    });
  });

  it("consumes pre-training timing and returns one caveated action", () => {
    const output = respondSync(
      advisorInput("What should I eat before training? — 30 minutes", freshRecord),
    );

    expect(output.trace.ruleId).toBe("pre-training-nutrition");
    expect(output.reply.kind).toBe("recommendation");
    expect(output.reply.text).toMatch(/with 30 minutes until training/i);
    expect(output.reply.text).not.toMatch(/how long until training/i);
    expect(output.decisions[0]).toMatchObject({
      evidenceStatus: "rule_based",
      ladderLevel: 2,
      gateOutcome: "caveated",
    });
    expect(output.decisions[0]?.choices).toEqual([
      "Use only a familiar tolerated option",
      "Do nothing for now",
    ]);
  });

  it("keeps asking when an appended detail is not a training time", () => {
    const output = respondSync(
      advisorInput("What should I eat before training? — tomorrow", freshRecord),
    );

    expect(output.trace.ruleId).toBe("pre-training-nutrition");
    expect(output.reply.kind).toBe("question");
    expect(output.reply.text).toMatch(/how long until training/i);
  });

  it.each([
    "I took medication 30 minutes ago. What should I eat before training?",
    "I ate lunch two hours ago. What should I eat before training?",
  ])("does not reuse unrelated timing as pre-training timing: %s", (text) => {
    const output = respondSync(advisorInput(text, freshRecord));

    expect(output.trace.ruleId).toBe("pre-training-nutrition");
    expect(output.reply.kind).toBe("question");
    expect(output.reply.text).toMatch(/how long until training/i);
    expect(output.reply.text).not.toMatch(/with (?:30 minutes|two hours) until training/i);
  });

  it("uses only timing explicitly scoped to training", () => {
    const output = respondSync(
      advisorInput(
        "I took medication 30 minutes ago. What should I eat before training? Training starts in two hours.",
        freshRecord,
      ),
    );

    expect(output.trace.ruleId).toBe("pre-training-nutrition");
    expect(output.reply.kind).toBe("recommendation");
    expect(output.reply.text).toMatch(/with two hours until training/i);
    expect(output.reply.text).not.toMatch(/with 30 minutes until training/i);
  });

  it("renders a clock training time as a truthful phrase", () => {
    const output = respondSync(
      advisorInput("What should I eat before training? Training is at 5 pm.", freshRecord),
    );

    expect(output.trace.ruleId).toBe("pre-training-nutrition");
    expect(output.reply.kind).toBe("recommendation");
    expect(output.reply.text).toMatch(/with training at 5 pm,/i);
    expect(output.reply.text).not.toMatch(/with at 5 pm until training/i);
    expect(output.decisions[0]?.expectedLag).toBe("Training at 5 pm");
  });

  it("accepts a direct clock time as the requested detail", () => {
    const output = respondSync(
      advisorInput("What should I eat before training? — at 5 pm", freshRecord),
    );

    expect(output.trace.ruleId).toBe("pre-training-nutrition");
    expect(output.reply.kind).toBe("recommendation");
    expect(output.reply.text).toMatch(/with training at 5 pm,/i);
  });

  it.each([
    "I have diabetes. What should I eat before training?",
    "I have kidney disease. What should I eat before training?",
    "I am allergic to eggs. What should I eat before training?",
  ])("keeps a medical restriction outside generic food advice: %s", (text) => {
    const output = respondSync(advisorInput(text, freshRecord));

    expect(output.trace.ruleId).toBe("pre-training-nutrition");
    expect(output.route).toBe("clinician");
    expect(output.reply.kind).toBe("route");
    expect(output.decisions[0]?.evidenceStatus).toBe("route_out");
    expect(output.reply.text).not.toMatch(/carbohydrate source|some protein/i);
    expect(output.decisions[0]?.refused).toMatch(/will not override/i);
  });

  it("consumes a medication-name correction without claiming a schedule match", () => {
    const initial = respondSync(
      advisorInput("I took my morning medication; help me keep the record accurate.", freshRecord),
    );
    const named = respondSync(
      advisorInput(
        "I took my morning medication; help me keep the record accurate. — lisinopril",
        freshRecord,
      ),
    );

    expect(initial.trace.ruleId).toBe("medication");
    expect(initial.reply.kind).toBe("question");
    expect(initial.reply.text).toMatch(/which medication/i);

    expect(named.trace.ruleId).toBe("medication");
    expect(named.reply.kind).toBe("record");
    expect(named.reply.text).toMatch(/lisinopril/i);
    expect(named.reply.text).toMatch(/not yet matched to a saved schedule or dose/i);
    expect(named.reply.text).not.toMatch(/which medication/i);
    expect(named.records).toContainEqual({
      kind: "medication_event",
      text: "I took my morning medication; help me keep the record accurate. — lisinopril",
    });
  });

  it("handles missing and directly supplied medication identities", () => {
    const unnamed = respondSync(advisorInput("Medication refill was picked up", freshRecord));
    const named = respondSync(advisorInput("I took lisinopril", freshRecord));

    expect(unnamed.trace.ruleId).toBe("medication");
    expect(unnamed.reply.kind).toBe("question");
    expect(unnamed.reply.text).toMatch(/which medication/i);

    expect(named.trace.ruleId).toBe("medication");
    expect(named.reply.kind).toBe("record");
    expect(named.reply.text).toMatch(/lisinopril/i);
  });

  it("rejects punctuation as a medication identity", () => {
    const output = respondSync(advisorInput("I took my morning medication — ???", freshRecord));

    expect(output.trace.ruleId).toBe("medication");
    expect(output.reply.kind).toBe("question");
    expect(output.reply.text).toMatch(/which medication/i);
  });

  it("does not turn medication questions, forgotten identity, or future hypotheticals into medication events", () => {
    for (const text of [
      "I have a question about sertraline",
      "I had a question about lisinopril",
      "I had lisinopril prescribed last year",
      "I might take lisinopril tomorrow",
      "Should I take lisinopril tomorrow?",
      "I forgot which medication I take",
    ]) {
      const output = respondSync(advisorInput(text, freshRecord));
      expect(output.trace.ruleId, text).not.toBe("medication");
      expect(
        output.records.some((record) => record.kind === "medication_event"),
        text,
      ).toBe(false);
    }
  });

  it.each([
    "I slept badly, took my morning meds, how should I train?",
    "I ate lunch and feel exhausted, should I train?",
    "I slept badly and ate lunch, do I train today?",
    "I slept badly and took lisinopril, is it okay to work out?",
    "I slept badly and took my medication, should I skip training?",
  ])("prioritizes the explicit training decision over incidental logging: %s", (text) => {
    const output = respondSync(advisorInput(text, freshRecord));

    expect(output.trace.ruleId).toBe("training-decision");
    expect(output.reply.kind).toBe("recommendation");
    expect(output.decisions[0]?.choices).toContain("Keep optional effort flexible today");
    expect(output.records.some((record) => record.kind === "medication_event")).toBe(false);
    expect(output.records.some((record) => record.kind === "meal")).toBe(false);
  });

  it("asks for the decision-relevant change instead of logging an incidental meal", () => {
    const output = respondSync(advisorInput("I ate lunch, should I train?", freshRecord));

    expect(output.trace.ruleId).toBe("training-decision");
    expect(output.reply.kind).toBe("question");
    expect(output.reply.text).toMatch(/what changed that should affect training/i);
    expect(output.records.some((record) => record.kind === "meal")).toBe(false);
  });

  it.each([
    {
      text: "I feel sick today, should I train?",
      choice: "Skip optional training today",
      reply: /feel sick today/i,
    },
    {
      text: "My schedule changed, should I train?",
      choice: "Move the session",
      reply: /schedule changed/i,
    },
    {
      text: "I only have 20 minutes, should I train?",
      choice: "Do a short familiar session",
      reply: /only 20 minutes available/i,
    },
    {
      text: "I've got only 20 minutes, should I train?",
      choice: "Do a short familiar session",
      reply: /only 20 minutes available/i,
    },
    {
      text: "I am short on time, should I train?",
      choice: "Do a short familiar session",
      reply: /limited time available/i,
    },
    {
      text: "I ate lunch, should I train? — my schedule changed",
      choice: "Move the session",
      reply: /schedule changed/i,
    },
  ])("consumes the stated training constraint: $text", ({ text, choice, reply }) => {
    const output = respondSync(advisorInput(text, freshRecord));

    expect(output.trace.ruleId).toBe("training-decision");
    expect(output.reply.kind).toBe("recommendation");
    expect(output.reply.text).toMatch(reply);
    expect(output.decisions[0]).toMatchObject({
      evidenceStatus: "rule_based",
      ladderLevel: 2,
      gateOutcome: "caveated",
    });
    expect(output.decisions[0]?.choices).toContain(choice);
    expect(output.records.some((record) => record.kind === "meal")).toBe(false);
    expect(output.records.some((record) => record.kind === "medication_event")).toBe(false);
  });

  it.each([
    "I did not sleep badly, should I train?",
    "I have not felt tired, should I train?",
    "I haven't felt tired, should I train?",
  ])("does not turn a negated recovery signal into low-energy advice: %s", (text) => {
    const output = respondSync(advisorInput(text, freshRecord));

    expect(output.trace.ruleId).toBe("training-decision");
    expect(output.reply.kind).toBe("question");
    expect(output.decisions[0]?.choices).toEqual([]);
    expect(output.reply.text).not.toMatch(/low-energy|keep optional effort flexible/i);
  });

  it.each(["I did not sleep well, should I train?", "I have felt tired, should I train?"])(
    "keeps an affirmative recovery signal actionable: %s",
    (text) => {
      const output = respondSync(advisorInput(text, freshRecord));

      expect(output.trace.ruleId).toBe("training-decision");
      expect(output.reply.kind).toBe("recommendation");
      expect(output.decisions[0]?.choices).toContain("Keep optional effort flexible today");
    },
  );

  it("turns unclassified context into one useful clarification", () => {
    const output = respondSync(advisorInput("I want to get healthier", freshRecord));

    expect(output.trace.ruleId).toBe("fallback");
    expect(output.reply.kind).toBe("question");
    expect(output.reply.text).toMatch(/what decision or change/i);
    expect(output.records).toEqual([{ kind: "context_note", text: "I want to get healthier" }]);
  });
});

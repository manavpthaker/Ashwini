import { describe, expect, it } from "vitest";
import {
  RULES_ADVISOR_VERSION,
  createRulesAdvisor,
  respondSync,
  runPipeline,
  type Rule,
} from "@/domain/advisor";
import { advisorInput, blockingConfound, present, sertraline, NOW } from "./support";

describe("createRulesAdvisor", () => {
  it("exposes a version that gets stamped on stored decisions", async () => {
    const advisor = createRulesAdvisor();
    expect(advisor.version).toBe(RULES_ADVISOR_VERSION);
    const output = await advisor.respond(advisorInput("i ate lunch"));
    expect(output.trace.ruleId).toBe("nutrition");
  });

  it("accepts a version override", () => {
    expect(createRulesAdvisor("rules-experimental").version).toBe("rules-experimental");
  });
});

describe("the confound gate applied centrally", () => {
  // PRD 11.5: a recommendation cannot survive a blocked window.
  it("downgrades a gated recommendation to a data-quality block", () => {
    const output = respondSync(
      advisorInput("i feel flat today", {
        commitments: [{ title: "Saved session", domain: "training", startsAt: NOW }],
        confoundDefinitions: [blockingConfound()],
        confoundEvaluations: [present("illness")],
      }),
    );

    expect(output.trace.ruleId).toBe("training-volume");
    const decision = output.decisions[0];
    expect(decision?.evidenceStatus).toBe("unusable");
    expect(decision?.ladderLevel).toBe(1);
    expect(decision?.type).toBe("data_quality_block");
    expect(decision?.gateOutcome).toBe("blocked");
    expect(output.reply.text).toMatch(/Illness is present/);
    expect(output.reply.text).toMatch(/rather tell you the window is unreadable/);
    expect(decision?.refused).toMatch(/will not issue a verdict/i);
  });

  it("leaves an ungated record alone even when the window is blocked", () => {
    // A logged dose is a fact, not a verdict; a dirty window does not erase it.
    const output = respondSync(
      advisorInput("took my meds", {
        confoundDefinitions: [blockingConfound()],
        confoundEvaluations: [present("illness")],
      }),
    );
    expect(output.trace.ruleId).toBe("medication");
    expect(output.decisions[0]?.evidenceStatus).toBe("recorded");
    expect(output.decisions[0]?.gateOutcome).toBe("clear");
  });

  it("does not turn a plain meal record into a verdict when confounds are unknown", () => {
    const output = respondSync(
      advisorInput("i ate lunch", {
        confoundDefinitions: [
          blockingConfound({ id: "incomplete_source_data", requiredForVerdict: true }),
        ],
      }),
    );

    expect(output.trace.ruleId).toBe("nutrition");
    expect(output.reply.receipt).toBe("Meal occurrence recorded · food detail still unknown");
    expect(output.decisions[0]).toMatchObject({
      evidenceStatus: "recorded",
      ladderLevel: 0,
      gateOutcome: "clear",
    });
  });

  it("keeps a fresh recovery action conservative and caveated", () => {
    const output = respondSync(
      advisorInput("i feel flat today", {
        confoundDefinitions: [
          blockingConfound({ id: "incomplete_source_data", requiredForVerdict: true }),
        ],
      }),
    );

    expect(output.trace.ruleId).toBe("training-volume");
    expect(output.reply.receipt).toBe("Recovery context recorded · optional effort kept flexible");
    expect(output.decisions[0]).toMatchObject({
      evidenceStatus: "rule_based",
      ladderLevel: 2,
      gateOutcome: "caveated",
    });
  });

  it("carries the confounds it checked onto the decision", () => {
    const output = respondSync(
      advisorInput("i feel flat today", {
        commitments: [{ title: "Saved session", domain: "training", startsAt: NOW }],
        confoundDefinitions: [blockingConfound({ blocking: false })],
        confoundEvaluations: [present("illness")],
      }),
    );
    const decision = output.decisions[0];
    expect(decision?.gateOutcome).toBe("caveated");
    expect(decision?.confoundsChecked).toHaveLength(1);
    expect(decision?.confoundsChecked[0]).toMatchObject({
      confoundId: "illness",
      state: "present",
      version: "2025-06-01",
    });
  });
});

describe("training context comes from saved commitments", () => {
  it("does not invent a session when no training commitment exists", () => {
    const output = respondSync(advisorInput("i feel flat today"));
    expect(output.reply.text).toMatch(/no saved session/i);
    expect(output.decisions[0]?.choices).toEqual([
      "Keep optional effort flexible today",
      "Do nothing for now",
    ]);
    expect(output.decisions[0]?.evidenceStatus).toBe("rule_based");
    expect(output.records).toContainEqual({
      kind: "context_note",
      text: "i feel flat today",
    });
  });

  it("offers a volume choice only when a training commitment is saved", () => {
    const output = respondSync(
      advisorInput("i feel flat today", {
        commitments: [
          { title: "Non-training task", domain: "system", startsAt: NOW },
          { title: "Saved session", domain: "training", startsAt: NOW },
        ],
      }),
    );
    expect(output.reply.text).toMatch(/saved training commitment/i);
    expect(output.decisions[0]?.choices).toEqual([
      "Reduced volume",
      "Full session",
      "Do nothing for now",
    ]);
    expect(output.decisions[0]?.evidenceStatus).toBe("rule_based");
  });
});

describe("PRD 11.7 — the supplement rule cannot answer from memory", () => {
  it("blocks when no current interaction result covers the item", () => {
    const output = respondSync(advisorInput("should i add creatine"));
    const decision = output.decisions[0];
    expect(output.trace.ruleId).toBe("supplement-interaction");
    expect(decision?.evidenceStatus).toBe("unusable");
    expect(decision?.gateOutcome).toBe("blocked");
    expect(decision?.gateReason).toMatch(/No current authorized interaction result/);
    expect(output.reply.text).toMatch(/no result means no answer, not a quiet all-clear/i);
    expect(output.records).toContainEqual({
      kind: "interaction_check_request",
      items: ["creatine"],
    });
  });

  it("treats an expired result as no result", () => {
    const output = respondSync(
      advisorInput("should i add creatine", {
        interactionResults: [
          {
            provider: "Examine Connect",
            items: ["creatine"],
            checkedAt: new Date("2025-05-01T00:00:00Z"),
            expiresAt: new Date("2025-06-01T00:00:00Z"), // before NOW
            evidenceGrade: "B",
            summary: "No interaction found.",
          },
        ],
      }),
    );
    expect(output.decisions[0]?.evidenceStatus).toBe("unusable");
  });

  it("cites a current result and names its provider and grade", () => {
    const output = respondSync(
      advisorInput("should i add creatine", {
        interactionResults: [
          {
            provider: "Examine Connect",
            items: ["creatine"],
            checkedAt: new Date("2025-06-26T00:00:00Z"),
            expiresAt: new Date("2025-07-26T00:00:00Z"),
            evidenceGrade: "B",
            summary: "No known interaction with your current list.",
          },
        ],
      }),
    );
    const decision = output.decisions[0];
    expect(decision?.evidenceStatus).toBe("rule_based");
    expect(decision?.ladderLevel).toBe(2);
    expect(output.reply.text).toMatch(/Examine Connect/);
    expect(output.reply.text).toMatch(/2025-06-26/);
    expect(output.reply.text).toMatch(/graded B/);
    expect(decision?.refused).toMatch(/will not extend this result to drug–drug/i);
  });

  it("omits the grade when the source did not provide one", () => {
    const output = respondSync(
      advisorInput("should i add magnesium", {
        interactionResults: [
          {
            provider: "Examine Connect",
            items: ["magnesium"],
            checkedAt: new Date("2025-06-26T00:00:00Z"),
            expiresAt: null,
            evidenceGrade: null,
            summary: "No known interaction.",
          },
        ],
      }),
    );
    expect(output.reply.text).not.toMatch(/graded/);
  });

  it("fires on intent alone, with nothing to check", () => {
    const output = respondSync(advisorInput("is there a supplement worth taking"));
    expect(output.trace.ruleId).toBe("supplement-interaction");
    expect(output.records).toEqual([]);
  });

  it("checks the supplement against everything the user already takes", () => {
    // PRD 7.3: the check is against the current list, not the supplement alone.
    const output = respondSync(
      advisorInput("should i add creatine", { medications: [sertraline] }),
    );
    expect(output.records).toContainEqual({
      kind: "interaction_check_request",
      items: ["creatine", "sertraline"],
    });
  });

  it("does not accept a result that omits a current medication", () => {
    const output = respondSync(
      advisorInput("should i add creatine", {
        medications: [sertraline, { name: "CREATINE", aliases: [], isPrescription: true }],
        interactionResults: [
          {
            provider: "Examine Connect",
            items: ["creatine"],
            checkedAt: new Date("2025-06-26T00:00:00Z"),
            expiresAt: new Date("2025-07-26T00:00:00Z"),
            evidenceGrade: "B",
            summary: "No known interaction.",
          },
        ],
      }),
    );

    expect(output.decisions[0]).toMatchObject({
      evidenceStatus: "unusable",
      gateOutcome: "blocked",
    });
    expect(output.records).toContainEqual({
      kind: "interaction_check_request",
      items: ["creatine", "sertraline"],
    });
  });

  it("accepts a current result only when it covers the deduped full subject set", () => {
    const output = respondSync(
      advisorInput("should i add creatine", {
        medications: [sertraline, { name: "CREATINE", aliases: [], isPrescription: true }],
        interactionResults: [
          {
            provider: "Examine Connect",
            items: ["CREATINE", "SERTRALINE"],
            checkedAt: new Date("2025-06-26T00:00:00Z"),
            expiresAt: new Date("2025-07-26T00:00:00Z"),
            evidenceGrade: "B",
            summary: "Current result covers the complete list.",
          },
        ],
      }),
    );

    expect(output.decisions[0]?.evidenceStatus).toBe("rule_based");
    expect(output.reply.text).toMatch(/Current result covers the complete list/);
  });

  it("does not turn a plain supplement log into an interaction question", () => {
    for (const text of ["Took my magnesium", "Had creatine with breakfast"]) {
      const output = respondSync(advisorInput(text));
      expect(output.trace.ruleId, text).not.toBe("supplement-interaction");
      expect(output.decisions[0]?.choices, text).toEqual([]);
      expect(output.reply.text, text).not.toMatch(/ask a pharmacist|interaction result/i);
    }
  });
});

describe("record intent is not inferred from topic words", () => {
  it("does not invent a meal occurrence from questions, plans, or a skipped meal", () => {
    for (const text of [
      "How much protein should I eat?",
      "I skipped breakfast",
      "I plan to eat dinner later",
      "Do eggs have protein?",
      "I did not eat breakfast",
      "I plan to eat breakfast tomorrow",
      "My daughter ate breakfast",
      "My daughter ate lunch and had a snack",
    ]) {
      const output = respondSync(advisorInput(text));
      expect(output.trace.ruleId, text).not.toBe("nutrition");
      expect(
        output.records.some((record) => record.kind === "meal"),
        text,
      ).toBe(false);
      expect(output.reply.text, text).not.toMatch(/recorded that the meal happened/i);
    }
  });

  it("does not infer fatigue from a positive or neutral training log", () => {
    for (const text of [
      "Training was great today",
      "I feel energetic and ready for the gym",
      "Had a good workout",
      "I feel great and have lots of energy for my workout",
      "I am not tired",
      "My wife is tired",
      "I might be tired tomorrow",
      "I don't feel tired",
      "I do not have low energy",
      "I am not low energy",
      "I don't have bad sleep",
      "My wife is tired and slept badly",
    ]) {
      const output = respondSync(
        advisorInput(text, {
          commitments: [{ title: "Saved session", domain: "training", startsAt: NOW }],
        }),
      );
      expect(output.trace.ruleId, text).not.toBe("training-volume");
      expect(output.decisions[0]?.choices, text).toEqual([]);
      expect(output.reply.text, text).not.toMatch(/low-energy|reduced volume/i);
    }
  });

  it("does not infer pain from a body-region word alone", () => {
    for (const text of [
      "My back feels strong",
      "Shoulder workout went well",
      "Knee feels normal today",
      "My ankle mobility improved",
      "My shoulder pain is gone",
      "I used to have back pain",
      "My back pain was last year",
      "My shoulder hurt yesterday but is fine now",
      "My dad has back pain and shoulder soreness",
    ]) {
      const output = respondSync(advisorInput(text));
      expect(output.trace.ruleId, text).not.toBe("symptom-msk");
      expect(output.reply.text, text).not.toMatch(/avoid loading the painful movement/i);
    }
  });
});

describe("drug–drug false positives", () => {
  // The guard that stops every logged dose from being routed to a pharmacist.
  it("does not route an adherence log that happens to say 'with'", () => {
    const output = respondSync(
      advisorInput("took my sertraline with breakfast", { medications: [sertraline] }),
    );
    expect(output.trace.ruleId).toBe("medication");
    expect(output.route).toBeNull();
    // The dose is what gets recorded, not the meal.
    expect(output.records).toContainEqual({
      kind: "medication_event",
      text: "took my sertraline with breakfast",
    });
  });

  it("does route the same medication inside a question", () => {
    expect(
      respondSync(
        advisorInput("can i take sertraline with grapefruit", { medications: [sertraline] }),
      ).trace.ruleId,
    ).toBe("drug-drug");
  });

  it("does not create an owner medication event from a third party or denied change", () => {
    for (const text of [
      "My dad took his pills",
      "I did not change my medication dose",
      "I did not swallow too many pills",
    ]) {
      const output = respondSync(advisorInput(text));
      expect(output.trace.ruleId, text).not.toBe("medication");
      expect(
        output.records.some((record) => record.kind === "medication_event"),
        text,
      ).toBe(false);
    }
  });
});

describe("the decision draft", () => {
  it("gives recommendations an expiry and leaves records open-ended", () => {
    // PRD 9 requires an expiry/review time on interruption-worthy output.
    const recommendation = respondSync(advisorInput("i feel flat today"));
    expect(recommendation.decisions[0]?.type).toBe("recommendation");
    expect(recommendation.decisions[0]?.expiresAt).toEqual(
      new Date(NOW.getTime() + 12 * 60 * 60 * 1000),
    );

    const routeOut = respondSync(advisorInput("i have chest pain"));
    expect(routeOut.decisions[0]?.expiresAt).toBeNull();
  });

  it("offers a do-nothing option where one is meaningful", () => {
    const output = respondSync(advisorInput("should i add creatine"));
    expect(output.decisions[0]?.choices).toContain("Do nothing for now");
  });
});

describe("pipeline integrity", () => {
  it("throws when no rule matches, rather than returning nothing", () => {
    expect(() => runPipeline([], advisorInput("anything"))).toThrow(
      /must end with an unconditional fallback/,
    );
  });

  it("refuses a level-4 verdict on a caveated window", () => {
    // No shipped rule can produce this, so it is driven directly. The point is
    // that the invariant holds for any future Advisor, including a model-backed one.
    const overreaching: Rule = {
      id: "synthetic-overreach",
      matches: () => true,
      apply: () => ({
        domain: "training",
        evidenceStatus: "consistent_pattern",
        ladderLevel: 4,
        decisionType: "recommendation",
        route: null,
        reply: { text: "This has recurred.", kind: "recommendation", receipt: "x" },
        records: [],
        followUp: null,
        confidenceNote: "",
        refused: "",
        choices: [],
        target: null,
        expectedLag: null,
        gated: true,
      }),
    };

    expect(() =>
      runPipeline(
        [overreaching],
        advisorInput("anything", {
          confoundDefinitions: [blockingConfound({ blocking: false })],
          confoundEvaluations: [present("illness")],
        }),
      ),
    ).toThrow(/a caveated gate cannot support/);
  });

  it("still refuses when a rule bypasses the gate to claim a verdict", () => {
    const ungatedVerdict: Rule = {
      id: "synthetic-ungated",
      matches: () => true,
      apply: () => ({
        domain: "training",
        evidenceStatus: "recorded",
        ladderLevel: 4, // recorded may not sit at level 4
        decisionType: "recommendation",
        route: null,
        reply: { text: "", kind: "record", receipt: "x" },
        records: [],
        followUp: null,
        confidenceNote: "",
        refused: "",
        choices: [],
        target: null,
        expectedLag: null,
        gated: false,
      }),
    };

    // Caught by the gate reconciliation before assertPermitted is reached, so the
    // message names the mismatch rather than the status rule.
    expect(() => runPipeline([ungatedVerdict], advisorInput("anything"))).toThrow(
      /a clear gate cannot support/,
    );
  });
});

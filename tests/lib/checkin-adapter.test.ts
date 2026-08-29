import { describe, expect, test } from "vitest";
import { toCheckinResponse, type ConversationTurn, type WireDecision } from "@/lib/checkin-adapter";
import { EVIDENCE_STATUSES } from "@/domain/evidence";
import { DOMAINS } from "@/domain/domains";

/**
 * The adapter is where the safety layer's answer becomes something a screen
 * renders, so the properties worth pinning are the ones a redesign could quietly
 * drop: a route-out must reach the interface as a blocked plan, and a gate must
 * never be invented.
 */

const decision = (over: Partial<WireDecision> = {}): WireDecision => ({
  type: "recommendation",
  domain: "training",
  evidenceStatus: "rule_based",
  gateOutcome: "clear",
  gateReason: "No confound evaluated as present.",
  confidenceNote: "Based on your report alone.",
  target: "Keep training consistency",
  refused: "No claim about the cause.",
  choices: ["Reduce volume", "Do nothing"],
  ...over,
});

const turn = (over: Partial<ConversationTurn> = {}): ConversationTurn => ({
  reply: { text: "Recorded.", kind: "record", receipt: "Context retained" },
  decisions: [decision()],
  records: [],
  followUp: null,
  route: null,
  ...over,
});

describe("evidence and gate labels", () => {
  test("every domain status has a display label the interface accepts", () => {
    for (const status of EVIDENCE_STATUSES) {
      const response = toCheckinResponse(
        turn({ decisions: [decision({ evidenceStatus: status })] }),
      );
      expect(response.status).toBeTruthy();
      expect(response.status).not.toContain("_");
    }
  });

  test("gate outcomes map one to one", () => {
    const gates = (["clear", "caveated", "blocked"] as const).map(
      (gateOutcome) => toCheckinResponse(turn({ decisions: [decision({ gateOutcome })] })).gate,
    );
    expect(gates).toEqual(["Clear", "Caveated", "Blocked"]);
  });

  test("a turn with no decision does not claim a clear gate", () => {
    // PRD 8: a gate is an evaluated outcome. Nothing evaluated is not "Clear".
    expect(toCheckinResponse(turn({ decisions: [] })).gate).toBe("Blocked");
  });
});

describe("route-outs reach the plan", () => {
  test("every route destination blocks training and raises attention", () => {
    const destinations = [
      "emergency",
      "crisis_line",
      "clinician",
      "pharmacist",
      "prescriber",
      "dermatologist",
    ] as const;

    for (const route of destinations) {
      const response = toCheckinResponse(
        turn({
          route,
          reply: { text: "This needs a person.", kind: "route", receipt: "Routed" },
          decisions: [
            decision({ type: "route_out", evidenceStatus: "route_out", gateOutcome: "blocked" }),
          ],
        }),
      );

      expect(response.kind).toBe("route-out");
      expect(response.effects.trainingGate).toBe("blocked");
      expect(response.effects.recommendedTrainingChoice).toBe("pause");
      expect(response.effects.attention).toBeDefined();
    }
  });

  test("a route-out in a non-training domain still blocks the plan", () => {
    // PRD 11.5: the block is on issuing a verdict, not on one domain.
    const response = toCheckinResponse(
      turn({
        route: "dermatologist",
        decisions: [decision({ domain: "body", type: "route_out", gateOutcome: "blocked" })],
      }),
    );
    expect(response.effects.trainingGate).toBe("blocked");
  });

  test("medicines questions read as a medication handoff, not an emergency", () => {
    for (const route of ["pharmacist", "prescriber"] as const) {
      expect(toCheckinResponse(turn({ route })).effects.attention).toBe("medication-event");
    }
    for (const route of ["emergency", "crisis_line", "clinician", "dermatologist"] as const) {
      expect(toCheckinResponse(turn({ route })).effects.attention).toBe("urgent-care");
    }
  });
});

describe("effects are established, never guessed", () => {
  test("a turn that establishes nothing sets nothing", () => {
    const response = toCheckinResponse(
      turn({ decisions: [decision({ domain: "system" })], records: [] }),
    );
    expect(response.effects).toEqual({});
  });

  test("a meal without a follow-up is recorded; with one it needs detail", () => {
    expect(toCheckinResponse(turn({ records: ["meal"] })).effects.mealStatus).toBe("recorded");
    expect(
      toCheckinResponse(turn({ records: ["meal"], followUp: "What was in it?" })).effects
        .mealStatus,
    ).toBe("needs-detail");
  });

  test("a caveated training gate favours reduced volume rather than full", () => {
    const response = toCheckinResponse(
      turn({ decisions: [decision({ gateOutcome: "caveated" })] }),
    );
    expect(response.effects.trainingGate).toBe("caution");
    expect(response.effects.recommendedTrainingChoice).toBe("reduced");
  });

  test("a clear training gate opens the choice without selecting one", () => {
    const response = toCheckinResponse(turn());
    expect(response.effects.trainingGate).toBe("clear");
    expect(response.effects.recommendedTrainingChoice).toBeUndefined();
  });

  test("a data-quality block withholds the verdict", () => {
    const response = toCheckinResponse(
      turn({
        decisions: [
          decision({ type: "data_quality_block", domain: "nutrition", gateOutcome: "blocked" }),
        ],
      }),
    );
    expect(response.effects.trainingGate).toBe("blocked");
  });

  test("the demo clock is never carried across", () => {
    expect(toCheckinResponse(turn()).effects.scenarioPhase).toBeUndefined();
  });
});

describe("what the user is shown", () => {
  test("the advisor's own words are the recommendation, unedited", () => {
    const text = "I'd take the painful movement out of today's session.";
    const response = toCheckinResponse(
      turn({ reply: { text, kind: "recommendation", receipt: "r" } }),
    );
    expect(response.recommendation).toBe(text);
  });

  test("the decision's refusal and gate reasoning survive the trip", () => {
    const response = toCheckinResponse(turn());
    expect(response.refused).toBe("No claim about the cause.");
    expect(response.gateReason).toBe("No confound evaluated as present.");
  });

  test("no acknowledgement is fabricated", () => {
    expect(toCheckinResponse(turn()).acknowledgement).toBe("");
  });

  test("the headline prefers the decision target, then the route, then the receipt", () => {
    expect(toCheckinResponse(turn()).headline).toBe("Keep training consistency");
    expect(toCheckinResponse(turn({ route: "pharmacist" })).headline).toContain("pharmacist");
    expect(toCheckinResponse(turn({ decisions: [decision({ target: null })] })).headline).toBe(
      "Context retained",
    );
  });

  test("recorded always states that the wording was kept", () => {
    expect(toCheckinResponse(turn()).recorded).toContain("Your wording, retained verbatim");
  });

  test("a therapy mention is shown as recorded without its content", () => {
    const recorded = toCheckinResponse(turn({ records: ["therapy_mention"] })).recorded;
    expect(recorded.some((item) => item.includes("content was not stored"))).toBe(true);
  });

  test("every domain produces a labelled perspective marked as synthesis", () => {
    for (const domain of DOMAINS) {
      const [perspective] = toCheckinResponse(
        turn({ decisions: [decision({ domain })] }),
      ).perspectives;
      expect(perspective?.origin).toBe("ashwini_synthesis");
      expect(perspective?.role).toBeTruthy();
    }
  });
});

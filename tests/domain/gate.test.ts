import { describe, expect, it } from "vitest";
import { evaluateGate, type ConfoundDefinition, type ConfoundEvaluation } from "@/domain/gate";

function definition(overrides: Partial<ConfoundDefinition> = {}): ConfoundDefinition {
  return {
    id: "sleep_debt",
    label: "Sleep debt",
    domains: ["training"],
    blocking: false,
    requiredForVerdict: false,
    threshold: { hoursBelowBaseline: 1.5 },
    version: "2025-06-01",
    ...overrides,
  };
}

const absent = (id: string): ConfoundEvaluation => ({ confoundId: id, state: "absent" });
const present = (id: string, detail?: string): ConfoundEvaluation => ({
  confoundId: id,
  state: "present",
  ...(detail === undefined ? {} : { detail }),
});

describe("evaluateGate", () => {
  it("is clear when every defined confound is absent", () => {
    const result = evaluateGate({
      domain: "training",
      definitions: [definition()],
      evaluations: [absent("sleep_debt")],
    });
    expect(result.outcome).toBe("clear");
    expect(result.checked).toHaveLength(1);
    expect(result.reason).toMatch(/checked and are absent/);
  });

  it("is clear, and says so, when the domain has no defined confounds", () => {
    const result = evaluateGate({
      domain: "focus",
      definitions: [definition({ domains: ["training"] })],
      evaluations: [],
    });
    expect(result.outcome).toBe("clear");
    expect(result.checked).toEqual([]);
    expect(result.reason).toMatch(/No confounds are defined/);
  });

  it("only considers confounds that apply to the domain under review", () => {
    const result = evaluateGate({
      domain: "nutrition",
      definitions: [
        definition({ id: "sleep_debt", domains: ["training"], blocking: true }),
        definition({ id: "travel", label: "Travel", domains: ["nutrition"] }),
      ],
      evaluations: [present("sleep_debt"), absent("travel")],
    });
    // The blocking training confound is present but irrelevant here.
    expect(result.outcome).toBe("clear");
    expect(result.checked.map((check) => check.confoundId)).toEqual(["travel"]);
  });

  // PRD 11.5 / 8: a blocking confound means no verdict at all.
  it("blocks when a blocking confound is present", () => {
    const result = evaluateGate({
      domain: "training",
      definitions: [definition({ id: "illness", label: "Illness", blocking: true })],
      evaluations: [present("illness", "Fever logged Tuesday")],
    });
    expect(result.outcome).toBe("blocked");
    expect(result.reason).toMatch(/No verdict: Illness is present/);
    expect(result.checked[0]?.detail).toBe("Fever logged Tuesday");
  });

  // PRD 8 lists "Incomplete source data" as a confound in its own right.
  it("blocks when a verdict-critical confound could not be checked", () => {
    const result = evaluateGate({
      domain: "medication",
      definitions: [
        definition({
          id: "adherence",
          label: "Medication adherence",
          domains: ["medication"],
          requiredForVerdict: true,
        }),
      ],
      evaluations: [],
    });
    expect(result.outcome).toBe("blocked");
    expect(result.reason).toMatch(/could not be checked/);
    expect(result.checked[0]?.state).toBe("unknown");
  });

  it("treats a missing evaluation as unknown rather than absent", () => {
    // Silence is not evidence of absence — the same principle as PRD 7.3.
    const result = evaluateGate({
      domain: "training",
      definitions: [definition()],
      evaluations: [],
    });
    expect(result.checked[0]?.state).toBe("unknown");
    expect(result.outcome).toBe("caveated");
    expect(result.reason).toMatch(/unconfirmed/);
  });

  it("caveats when a non-blocking confound is present", () => {
    const result = evaluateGate({
      domain: "training",
      definitions: [definition()],
      evaluations: [present("sleep_debt")],
    });
    expect(result.outcome).toBe("caveated");
    expect(result.reason).toMatch(/low-risk recommendation is still available/);
  });

  it("prefers blocking over caveating when both kinds are present", () => {
    const result = evaluateGate({
      domain: "training",
      definitions: [
        definition({ id: "sleep_debt" }),
        definition({ id: "illness", label: "Illness", blocking: true }),
      ],
      evaluations: [present("sleep_debt"), present("illness")],
    });
    expect(result.outcome).toBe("blocked");
  });

  it("prefers a present blocking confound over an unchecked required one", () => {
    const result = evaluateGate({
      domain: "training",
      definitions: [
        definition({ id: "illness", label: "Illness", blocking: true }),
        definition({ id: "adherence", label: "Adherence", requiredForVerdict: true }),
      ],
      evaluations: [present("illness")],
    });
    expect(result.outcome).toBe("blocked");
    expect(result.reason).toMatch(/Illness is present/);
  });

  it("reads naturally with two and with three confounds named", () => {
    const two = evaluateGate({
      domain: "training",
      definitions: [
        definition({ id: "a", label: "Travel", blocking: true }),
        definition({ id: "b", label: "Illness", blocking: true }),
      ],
      evaluations: [present("a"), present("b")],
    });
    expect(two.reason).toMatch(/Travel and Illness are present/);

    const three = evaluateGate({
      domain: "training",
      definitions: [
        definition({ id: "a", label: "Travel", blocking: true }),
        definition({ id: "b", label: "Illness", blocking: true }),
        definition({ id: "c", label: "Alcohol", blocking: true }),
      ],
      evaluations: [present("a"), present("b"), present("c")],
    });
    expect(three.reason).toMatch(/Travel, Illness, and Alcohol are present/);
  });

  it("carries the threshold version of every confound it checked", () => {
    // PRD 8: thresholds must be versioned, and the version travels with the outcome
    // so a stored decision can be re-read against the rules that produced it.
    const result = evaluateGate({
      domain: "training",
      definitions: [definition({ version: "2025-06-01" })],
      evaluations: [absent("sleep_debt")],
    });
    expect(result.checked[0]?.version).toBe("2025-06-01");
  });
});

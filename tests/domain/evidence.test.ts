import { describe, expect, it } from "vitest";
import {
  EVIDENCE_LABEL,
  EVIDENCE_MEANING,
  EVIDENCE_STATUSES,
  EvidenceViolation,
  GATE_OUTCOMES,
  assertPermitted,
  isEvidenceStatus,
  isGateOutcome,
  isPermitted,
  type EvidenceStatus,
  type GateOutcome,
  type LadderLevel,
} from "@/domain/evidence";

describe("the PRD 4.5 vocabulary", () => {
  it("has exactly the statuses the PRD table defines", () => {
    // Pinned against docs/PRD.md section 4.5. If the PRD changes, this fails first.
    expect([...EVIDENCE_STATUSES]).toEqual([
      "recorded",
      "unusable",
      "rule_based",
      "working_hypothesis",
      "noticed",
      "tracking",
      "early_signal",
      "consistent_pattern",
      "personally_useful",
      "route_out",
    ]);
  });

  it("has exactly the three gate outcomes PRD 8 defines", () => {
    expect([...GATE_OUTCOMES]).toEqual(["clear", "caveated", "blocked"]);
  });

  it("gives every status a display label and a meaning", () => {
    for (const status of EVIDENCE_STATUSES) {
      expect(EVIDENCE_LABEL[status]).toBeTruthy();
      expect(EVIDENCE_MEANING[status]).toBeTruthy();
    }
  });

  it("recognises its own members and rejects anything else", () => {
    expect(isEvidenceStatus("route_out")).toBe(true);
    expect(isEvidenceStatus("Route out")).toBe(false);
    expect(isEvidenceStatus(7)).toBe(false);
    expect(isGateOutcome("blocked")).toBe(true);
    expect(isGateOutcome("Blocked")).toBe(false);
    expect(isGateOutcome(null)).toBe(false);
  });
});

describe("assertPermitted", () => {
  it("allows each status at its own ladder level on a clear window", () => {
    const valid: ReadonlyArray<[EvidenceStatus, LadderLevel]> = [
      ["recorded", 0],
      ["noticed", 0],
      ["unusable", 1],
      ["rule_based", 2],
      ["rule_based", 3],
      ["working_hypothesis", 3],
      ["tracking", 2],
      ["early_signal", 3],
      ["consistent_pattern", 4],
      ["personally_useful", 4],
      ["route_out", 5],
    ];
    for (const [status, level] of valid) {
      // `unusable` and `route_out` are legitimate on a clear window too.
      expect(() => assertPermitted(status, "clear", level)).not.toThrow();
    }
  });

  it("rejects a status sitting on a rung that is not its own", () => {
    expect(() => assertPermitted("recorded", "clear", 4)).toThrow(EvidenceViolation);
    expect(() => assertPermitted("early_signal", "clear", 4)).toThrow(
      /cannot sit at ladder level 4/,
    );
    expect(() => assertPermitted("route_out", "clear", 2)).toThrow(EvidenceViolation);
  });

  // PRD 11.5: "No verdict is issued for a blocked/confounded window."
  describe("a blocked window", () => {
    it("permits only unusable and route_out", () => {
      expect(() => assertPermitted("unusable", "blocked", 1)).not.toThrow();
      expect(() => assertPermitted("route_out", "blocked", 5)).not.toThrow();
    });

    it("refuses every other status", () => {
      const forbidden: ReadonlyArray<[EvidenceStatus, LadderLevel]> = [
        ["recorded", 0],
        ["noticed", 0],
        ["rule_based", 2],
        ["tracking", 2],
        ["early_signal", 3],
        ["consistent_pattern", 4],
        ["personally_useful", 4],
      ];
      for (const [status, level] of forbidden) {
        expect(() => assertPermitted(status, "blocked", level)).toThrow(EvidenceViolation);
      }
    });
  });

  // PRD 4.6: daily actions create evidence; they do not call a result.
  describe("a caveated window", () => {
    it("still supports a low-risk recommendation", () => {
      expect(() => assertPermitted("rule_based", "caveated", 2)).not.toThrow();
      expect(() => assertPermitted("early_signal", "caveated", 3)).not.toThrow();
    });

    it("cannot support a pattern verdict", () => {
      expect(() => assertPermitted("consistent_pattern", "caveated", 4)).toThrow(
        /cannot support "consistent_pattern"/,
      );
      expect(() => assertPermitted("personally_useful", "caveated", 4)).toThrow(EvidenceViolation);
    });
  });

  // PRD 5: "No Level 3 association may be presented as Level 4 causality."
  it("requires a clear gate for any level 4 result", () => {
    expect(() => assertPermitted("consistent_pattern", "clear", 4)).not.toThrow();
    for (const gate of ["caveated", "blocked"] as const) {
      expect(() => assertPermitted("consistent_pattern", gate, 4)).toThrow(EvidenceViolation);
    }
  });

  it("reports violations without throwing when asked", () => {
    expect(isPermitted("consistent_pattern", "clear", 4)).toBe(true);
    expect(isPermitted("consistent_pattern", "blocked", 4)).toBe(false);
  });

  it("fails closed across the whole status/gate/level space", () => {
    // Exhaustive sweep: nothing outside the permitted set may pass, and a
    // level-4 or blocked-window verdict must never slip through.
    const levels: readonly LadderLevel[] = [0, 1, 2, 3, 4, 5];
    let permittedCount = 0;

    for (const status of EVIDENCE_STATUSES) {
      for (const gate of GATE_OUTCOMES as readonly GateOutcome[]) {
        for (const level of levels) {
          if (!isPermitted(status, gate, level)) continue;
          permittedCount += 1;

          if (gate === "blocked") {
            expect(["unusable", "route_out"]).toContain(status);
          }
          if (level === 4) {
            expect(gate).toBe("clear");
            expect(["consistent_pattern", "personally_useful"]).toContain(status);
          }
          if (level === 5) {
            expect(status).toBe("route_out");
          }
        }
      }
    }

    expect(permittedCount).toBeGreaterThan(0);
  });
});

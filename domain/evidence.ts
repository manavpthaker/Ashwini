/**
 * The epistemic vocabulary, straight from the PRD.
 *
 * PRD 4.5: "Every meaningful output carries a label. A guess cannot become a
 * fact by repeated display."
 *
 * These are stored snake_case (matching the `evidence_status` Postgres enum) and
 * displayed through EVIDENCE_LABEL. A test pins both against the PRD table so
 * the two cannot drift.
 */

export const EVIDENCE_STATUSES = [
  "recorded",
  "unusable",
  "rule_based",
  "noticed",
  "tracking",
  "early_signal",
  "consistent_pattern",
  "personally_useful",
  "route_out",
] as const;

export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

/** PRD 8: the confound gate has exactly three outcomes. */
export const GATE_OUTCOMES = ["clear", "caveated", "blocked"] as const;
export type GateOutcome = (typeof GATE_OUTCOMES)[number];

/** PRD 5: the inference ladder. Rungs are not interchangeable. */
export type LadderLevel = 0 | 1 | 2 | 3 | 4 | 5;

export const EVIDENCE_LABEL: Record<EvidenceStatus, string> = {
  recorded: "Recorded",
  unusable: "Unusable",
  rule_based: "Rule-based",
  noticed: "Noticed",
  tracking: "Tracking",
  early_signal: "Early signal",
  consistent_pattern: "Consistent pattern",
  personally_useful: "Personally useful",
  route_out: "Route out",
};

export const EVIDENCE_MEANING: Record<EvidenceStatus, string> = {
  recorded: "A source says this occurred.",
  unusable: "Data quality or confounds prevent interpretation.",
  rule_based: "An agreed rule applies to current facts.",
  noticed: "A natural variation is worth retaining.",
  tracking: "The user is deliberately repeating a small routine.",
  early_signal: "A small pattern appears, with material uncertainty.",
  consistent_pattern: "A relationship recurs across comparable clean windows.",
  personally_useful: "A repeated, safe comparison supports retaining a routine.",
  route_out: "The system must defer to a clinician, pharmacist, or dermatologist.",
};

/**
 * Which ladder rungs each status may occupy.
 *
 * The PRD is explicit at the ends and looser in the middle, so this is tight
 * where PRD 5 is tight (1, 4, 5) and permits the 2-3 span where a status can
 * legitimately back either an operational inference or a working synthesis.
 */
const LEVELS_BY_STATUS: Record<EvidenceStatus, readonly LadderLevel[]> = {
  recorded: [0],
  noticed: [0],
  unusable: [1],
  rule_based: [2, 3],
  tracking: [2, 3],
  early_signal: [3],
  consistent_pattern: [4],
  personally_useful: [4],
  route_out: [5],
};

/** Statuses that assert a durable personal finding rather than a momentary read. */
const VERDICT_STATUSES: readonly EvidenceStatus[] = ["consistent_pattern", "personally_useful"];

export class EvidenceViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceViolation";
  }
}

/**
 * The single invariant every advisor output passes through.
 *
 * It exists so that the safety rules are enforced once, centrally, rather than
 * trusted to each rule — and so a future model-backed Advisor inherits them
 * without being asked to cooperate.
 *
 *   PRD 11.5 / 8   No verdict is issued for a blocked or confounded window.
 *   PRD 5          No Level 3 association may be presented as Level 4 causality.
 *   PRD 4.4 / 5    A route-out is Level 5 and nothing else is.
 */
export function assertPermitted(
  status: EvidenceStatus,
  gate: GateOutcome,
  level: LadderLevel,
): void {
  const allowed = LEVELS_BY_STATUS[status];
  if (!allowed.includes(level)) {
    throw new EvidenceViolation(
      `Status "${status}" cannot sit at ladder level ${level} (allowed: ${allowed.join(", ")}).`,
    );
  }

  // PRD 11.5: a blocked window explains itself or routes out. It never concludes.
  if (gate === "blocked" && status !== "unusable" && status !== "route_out") {
    throw new EvidenceViolation(
      `A blocked window permits only "unusable" or "route_out", not "${status}".`,
    );
  }

  // A caveated window may still carry a low-risk recommendation (PRD 8, outcome 2),
  // but naming uncertainty and then declaring a pattern is exactly the move 4.6 forbids.
  if (gate === "caveated" && VERDICT_STATUSES.includes(status)) {
    throw new EvidenceViolation(
      `A caveated window cannot support "${status}"; the comparison is not clean.`,
    );
  }

  // PRD 5: a Level 4 personal-comparison result requires both a verdict-grade
  // status and an uncontaminated window.
  if (level === 4 && gate !== "clear") {
    throw new EvidenceViolation(
      `Level 4 is a personal comparison result and requires a clear gate, not "${gate}".`,
    );
  }
}

/** Non-throwing form, for callers choosing between candidate outputs. */
export function isPermitted(
  status: EvidenceStatus,
  gate: GateOutcome,
  level: LadderLevel,
): boolean {
  try {
    assertPermitted(status, gate, level);
    return true;
  } catch (error) {
    if (error instanceof EvidenceViolation) return false;
    throw error;
  }
}

export function isEvidenceStatus(value: unknown): value is EvidenceStatus {
  return typeof value === "string" && (EVIDENCE_STATUSES as readonly string[]).includes(value);
}

export function isGateOutcome(value: unknown): value is GateOutcome {
  return typeof value === "string" && (GATE_OUTCOMES as readonly string[]).includes(value);
}

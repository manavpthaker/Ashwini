/**
 * The confound and evidence gate (PRD 8).
 *
 * Before any verdict or personal-comparison result, the window is checked for
 * the relevant confounds. The gate has exactly three outputs: clear, caveated,
 * blocked.
 *
 * PRD 8 is explicit that "Thresholds are not assumed; they must be specified by
 * domain and versioned before implementation", so definitions are data — rows in
 * `ashwini.confound_definitions`, carrying a version — and this module is only
 * the resolution rule over them. Changing a threshold is a migration, not an
 * edited magic number.
 */

import type { Domain } from "./domains";
import type { GateOutcome } from "./evidence";

export type ConfoundState = "absent" | "present" | "unknown";

export interface ConfoundDefinition {
  readonly id: string;
  readonly label: string;
  /** Domains whose verdicts this confound can contaminate. */
  readonly domains: readonly Domain[];
  /** Present ⇒ blocked. Otherwise present ⇒ caveated. */
  readonly blocking: boolean;
  /**
   * Whether an unknown state blocks. PRD 8 lists "Incomplete source data" as a
   * confound in its own right: for these, not knowing is not the same as fine.
   */
  readonly requiredForVerdict: boolean;
  /** Threshold definition, opaque here and interpreted by the evaluator that produced the state. */
  readonly threshold: Readonly<Record<string, unknown>>;
  readonly version: string;
}

export interface ConfoundEvaluation {
  readonly confoundId: string;
  readonly state: ConfoundState;
  readonly detail?: string;
}

export interface ConfoundCheck {
  readonly confoundId: string;
  readonly label: string;
  readonly state: ConfoundState;
  readonly blocking: boolean;
  readonly version: string;
  readonly detail?: string;
}

export interface GateResult {
  readonly outcome: GateOutcome;
  readonly reason: string;
  readonly checked: readonly ConfoundCheck[];
}

export interface GateInput {
  readonly domain: Domain;
  readonly definitions: readonly ConfoundDefinition[];
  readonly evaluations: readonly ConfoundEvaluation[];
}

/**
 * Resolve a window to one of PRD 8's three outcomes.
 *
 * A confound with no evaluation is `unknown`, never `absent` — silence is not
 * evidence of absence, which is the same principle PRD 7.3 states for
 * interaction safety.
 */
export function evaluateGate({ domain, definitions, evaluations }: GateInput): GateResult {
  const byId = new Map(evaluations.map((evaluation) => [evaluation.confoundId, evaluation]));

  const checked: ConfoundCheck[] = definitions
    .filter((definition) => definition.domains.includes(domain))
    .map((definition) => {
      const evaluation = byId.get(definition.id);
      return {
        confoundId: definition.id,
        label: definition.label,
        state: evaluation?.state ?? "unknown",
        blocking: definition.blocking,
        version: definition.version,
        ...(evaluation?.detail === undefined ? {} : { detail: evaluation.detail }),
      };
    });

  const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));

  const blockingPresent = checked.filter((check) => check.state === "present" && check.blocking);
  if (blockingPresent.length > 0) {
    return {
      outcome: "blocked",
      reason: `No verdict: ${listLabels(blockingPresent)} ${verb(blockingPresent)} present in this window.`,
      checked,
    };
  }

  const missingRequired = checked.filter(
    (check) =>
      check.state === "unknown" &&
      definitionById.get(check.confoundId)?.requiredForVerdict === true,
  );
  if (missingRequired.length > 0) {
    return {
      outcome: "blocked",
      reason: `No verdict: ${listLabels(missingRequired)} could not be checked for this window.`,
      checked,
    };
  }

  const softPresent = checked.filter((check) => check.state === "present");
  if (softPresent.length > 0) {
    return {
      outcome: "caveated",
      reason: `${listLabels(softPresent)} ${verb(softPresent)} present; a low-risk recommendation is still available.`,
      checked,
    };
  }

  const remainingUnknown = checked.filter((check) => check.state === "unknown");
  if (remainingUnknown.length > 0) {
    return {
      outcome: "caveated",
      reason: `${listLabels(remainingUnknown)} ${verb(remainingUnknown)} unconfirmed for this window.`,
      checked,
    };
  }

  return {
    outcome: "clear",
    reason:
      checked.length === 0
        ? "No confounds are defined for this domain."
        : "All defined confounds were checked and are absent.",
    checked,
  };
}

function listLabels(checks: readonly ConfoundCheck[]): string {
  const labels = checks.map((check) => check.label);
  if (labels.length === 1) return labels[0] as string;
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function verb(checks: readonly ConfoundCheck[]): string {
  return checks.length === 1 ? "is" : "are";
}

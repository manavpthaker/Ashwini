/**
 * The deterministic advisor.
 *
 * Strictly first-match-wins over an ordered pipeline, so rule order *is* the
 * safety property. Safety rules run first and terminate; guidance rules follow.
 *
 * Everything a rule produces passes through the confound gate and then through
 * `assertPermitted`. That is deliberate: the safety invariants are enforced once
 * here, centrally, rather than trusted to each rule — which is what lets a future
 * ModelAdvisor inherit them without being asked to cooperate.
 */

import { assertPermitted, isPermitted } from "../evidence";
import { evaluateGate, type GateResult } from "../gate";
import type { Rule, RuleOutcome } from "./rule";
import { normalize } from "./rule";
import { guidanceRules } from "./rules/guidance";
import { safetyRules } from "./rules/safety";
import type { Advisor, AdvisorInput, AdvisorOutput, DecisionDraft } from "./types";

export const RULE_PIPELINE: readonly Rule[] = [...safetyRules, ...guidanceRules];

/** Bumped whenever rule behaviour changes; stamped on every decision written. */
export const RULES_ADVISOR_VERSION = "rules-1.0.0";

/** How long a recommendation stands before it needs revisiting (PRD 9 requires an expiry). */
const RECOMMENDATION_TTL_MS = 12 * 60 * 60 * 1000;

const CLEAR_GATE: GateResult = {
  outcome: "clear",
  reason: "No confound gate applies to this output.",
  checked: [],
};

export function createRulesAdvisor(version: string = RULES_ADVISOR_VERSION): Advisor {
  return {
    version,
    respond(input: AdvisorInput): Promise<AdvisorOutput> {
      return Promise.resolve(respondSync(input));
    },
  };
}

export function respondSync(input: AdvisorInput): AdvisorOutput {
  const context = { input, text: normalize(input.utterance.text) };

  const rule = RULE_PIPELINE.find((candidate) => candidate.matches(context));
  if (!rule) {
    // fallbackRule matches everything, so this is unreachable unless the
    // pipeline is edited into an unsafe state. Fail loudly rather than silently.
    throw new Error("No rule matched. The pipeline must end with an unconditional fallback.");
  }

  const outcome = rule.apply(context);
  const gate = resolveGate(input, outcome);
  const final = downgradeIfNeeded(outcome, gate);

  // If this throws, a rule is emitting something the PRD forbids. That is a bug
  // in the rule, not a runtime condition to swallow.
  assertPermitted(final.evidenceStatus, gate.outcome, final.ladderLevel);

  return {
    reply: final.reply,
    decisions: [toDecision(final, gate, rule.id, input)],
    records: final.records,
    followUp: final.followUp,
    route: final.route,
    trace: { ruleId: rule.id },
  };
}

function resolveGate(input: AdvisorInput, outcome: RuleOutcome): GateResult {
  if (outcome.gateOverride) return outcome.gateOverride;
  if (!outcome.gated) return CLEAR_GATE;
  return evaluateGate({
    domain: outcome.domain,
    definitions: input.context.confoundDefinitions,
    evaluations: input.context.confoundEvaluations,
  });
}

/**
 * PRD 11.5: a blocked window explains itself and issues no verdict.
 *
 * Rather than asking every rule to remember this, the pipeline converts any
 * recommendation that the gate will not permit into a data-quality block, using
 * the gate's own reason as the explanation.
 */
function downgradeIfNeeded(outcome: RuleOutcome, gate: GateResult): RuleOutcome {
  if (isPermitted(outcome.evidenceStatus, gate.outcome, outcome.ladderLevel)) {
    return outcome;
  }

  if (gate.outcome !== "blocked") {
    // A caveated window that still rejects the output means the rule asked for a
    // verdict it cannot have. Surfacing it is better than quietly rewriting it.
    throw new Error(
      `Rule produced "${outcome.evidenceStatus}" at level ${outcome.ladderLevel}, which a ${gate.outcome} gate cannot support.`,
    );
  }

  return {
    ...outcome,
    evidenceStatus: "unusable",
    ladderLevel: 1,
    decisionType: "data_quality_block",
    reply: {
      text: `${gate.reason} I'd rather tell you the window is unreadable than give you a number that looks confident and isn't.`,
      kind: "question",
      receipt: "Blocked · confounded window",
    },
    followUp: null,
    choices: [],
    confidenceNote: gate.reason,
    refused: "Ashwini will not issue a verdict from a confounded or incomplete window.",
  };
}

function toDecision(
  outcome: RuleOutcome,
  gate: GateResult,
  ruleId: string,
  input: AdvisorInput,
): DecisionDraft {
  const isRecommendation = outcome.decisionType === "recommendation";
  return {
    type: outcome.decisionType,
    domain: outcome.domain,
    evidenceStatus: outcome.evidenceStatus,
    ladderLevel: outcome.ladderLevel,
    gateOutcome: gate.outcome,
    gateReason: gate.reason,
    confoundsChecked: gate.checked,
    confidenceNote: outcome.confidenceNote,
    target: outcome.target,
    expectedLag: outcome.expectedLag,
    choices: outcome.choices,
    refused: outcome.refused,
    sources: [],
    expiresAt: isRecommendation ? new Date(input.now.getTime() + RECOMMENDATION_TTL_MS) : null,
    reviewAt: null,
    ruleId,
  };
}

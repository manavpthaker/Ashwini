import "server-only";
import {
  normalize,
  runPipeline,
  safetyRules,
  type AdvisorInput,
  type AdvisorOutput,
  type SubjectContext,
} from "@/domain/advisor";

const CONTEXT_INDEPENDENT_PREFIX = new Set([
  "crisis",
  "urgent-symptoms",
  "musculoskeletal-red-flag",
  "pregnancy",
  "skin-lesion",
]);

/** This is only a safety preflight, never a substitute for the owner's chart. */
export function preflightContext(): SubjectContext {
  return {
    mealsToday: [],
    commitments: [],
    activeRoutines: [],
    medications: [],
    supplements: [],
    interactionResults: [],
    confoundDefinitions: [],
    confoundEvaluations: [],
  };
}

/**
 * Only the context-independent prefix may return before database retrieval.
 * Stop at the first context-dependent rule: skipping over it could change
 * pipeline priority (for example medication routing before therapy privacy).
 */
export function immediateSafetyResponse(input: AdvisorInput): AdvisorOutput | null {
  const context = { input, text: normalize(input.utterance.text) };
  for (const rule of safetyRules) {
    if (!CONTEXT_INDEPENDENT_PREFIX.has(rule.id)) break;
    if (rule.matches(context)) return runPipeline([rule], input);
  }
  return null;
}

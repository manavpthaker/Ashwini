import type { Domain } from "../domains";
import type { EvidenceStatus, LadderLevel } from "../evidence";
import type { GateResult } from "../gate";
import type {
  AdvisorInput,
  AdvisorReply,
  DecisionType,
  RecordDraft,
  RouteDestination,
} from "./types";

export interface RuleContext {
  readonly input: AdvisorInput;
  /** The utterance lowercased with whitespace collapsed. Rules match on this. */
  readonly text: string;
}

export interface AttributedHealthClause {
  readonly text: string;
  /**
   * `self` requires an explicit first-person health assertion when a named
   * third party also appears. `third_party` carries across a coordinated
   * clause ("My dad has chest pain and cannot breathe"). `unspecified` keeps
   * terse owner check-ins such as "chest pain" usable without pretending a
   * clearly named family member is the owner.
   */
  readonly subject: "self" | "third_party" | "unspecified";
}

const THIRD_PARTY_SUBJECT =
  /\b(?:my|our) (?:dad|father|mom|mother|parent|wife|husband|partner|son|daughter|child|friend|brother|sister|roommate|coworker)\b|\b(?:he|she|they|someone) (?:has|have|had|is|are|feels?|felt|reported|says?|took|takes|went|fainted|collapsed)\b/i;

const FIRST_PERSON_HEALTH_ASSERTION =
  /\b(?:i|we)(?:'m|'re|'ve|'d)?\s+(?:am|are|have|had|feel|felt|cannot|can't|ate|finished|took|taken|swallowed|ingested|fainted|collapsed|passed out|overdosed?|hurt|ache|ached|slept|breastfeed\w*|nurs\w*|pregnan\w*|postpartum)\b|\b(?:(?:can|could|should|would|may) i|i (?:can|could|should|would|may)) (?:take|use|combine|mix|start|change|increase|decrease|raise|lower|double|halve|split|stop|skip|switch|taper)\b|\bmy (?:chest|throat|tongue|face|speech|vision|head|arm|side|leg|stool|vomit|urine|back|neck|shoulder|knee|hip|elbow|wrist|ankle|hamstring|calf|groin|achilles|dose|medication|prescription)\b/i;

/**
 * Split free-form health text without losing who a coordinated clause belongs
 * to. This is deliberately conservative: a named third party wins unless the
 * same clause contains a concrete first-person health assertion.
 */
export function attributedHealthClauses(text: string): readonly AttributedHealthClause[] {
  const clauses = text
    .split(/(?:[,.!?;]+|\b(?:and|but|however|because|after|while|although|yet)\b)/)
    .map((clause) => clause.trim())
    .filter(Boolean);

  let carried: AttributedHealthClause["subject"] = "unspecified";
  return clauses.map((clause) => {
    const hasThirdParty = THIRD_PARTY_SUBJECT.test(clause);
    const hasExplicitSelf = FIRST_PERSON_HEALTH_ASSERTION.test(clause);
    const subject = hasExplicitSelf ? "self" : hasThirdParty ? "third_party" : carried;
    carried = subject;
    return { text: clause, subject };
  });
}

export function isOwnerHealthClause(clause: AttributedHealthClause): boolean {
  return clause.subject !== "third_party";
}

export interface RuleOutcome {
  readonly domain: Domain;
  readonly evidenceStatus: EvidenceStatus;
  readonly ladderLevel: LadderLevel;
  readonly decisionType: DecisionType;
  readonly reply: AdvisorReply;
  readonly records: readonly RecordDraft[];
  readonly followUp: string | null;
  readonly route: RouteDestination | null;
  readonly confidenceNote: string;
  /** What this output explicitly declines to claim (PRD 4.5, 11.10). */
  readonly refused: string;
  readonly choices: readonly string[];
  readonly target: string | null;
  readonly expectedLag: string | null;
  /**
   * Whether the confound gate applies.
   *
   * Recommendations are gated: a contaminated window must not produce one
   * (PRD 11.5). Route-outs and plain records are not — a symptom still needs
   * routing whether or not last week's sleep data was clean.
   */
  readonly gated: boolean;
  /**
   * An explicit gate result, for blocks that are not confound-derived.
   *
   * PRD 8's blocked outcome covers "missing/contaminating conditions", so a
   * supplement question with no current authorized interaction result is
   * genuinely blocked — but by a missing source, not a dirty window. Saying so
   * precisely is what keeps the stored decision honest.
   */
  readonly gateOverride?: GateResult;
}

/**
 * One rule in the pipeline.
 *
 * The pipeline is strictly first-match-wins, so **rule order is the safety
 * property**. `tests/domain/advisor/order.test.ts` pins it. A rule that matches
 * broadly must sit below every rule that needs to see the same words first —
 * this is exactly what the prototype got wrong, where a musculoskeletal matcher
 * on `back` swallowed "the mole on my back".
 */
export interface Rule {
  readonly id: string;
  matches(context: RuleContext): boolean;
  apply(context: RuleContext): RuleOutcome;
}

/** Names from the user's own medication list that appear in the utterance. */
export function mentionedMedications(context: RuleContext): readonly string[] {
  const found: string[] = [];
  for (const medication of context.input.context.medications) {
    const candidates = [medication.name, ...medication.aliases];
    if (candidates.some((candidate) => containsWord(context.text, candidate.toLowerCase()))) {
      found.push(medication.name);
    }
  }
  return found;
}

/** Whole-word containment, so "iron" does not match "environment". */
export function containsWord(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`).test(haystack);
}

export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201b\u02bc]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

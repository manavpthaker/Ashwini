import { normalize } from "./rule";

/**
 * Content whose wording is deliberately excluded from the durable record.
 *
 * This is a privacy classifier, not a diagnosis or a clinical assessment. It
 * fails conservatively: a false positive loses one piece of wording, while a
 * false negative would retain content the product promises never to store.
 */
export type SensitiveRuleId = "crisis" | "therapy-content";

export const SENSITIVE_REDACTION: Readonly<Record<SensitiveRuleId, string>> = {
  crisis: "Crisis check-in received · content not retained",
  "therapy-content": "Therapy session mentioned · content not retained",
};

const CRISIS_PATTERNS: readonly RegExp[] = [
  /\bsuicid\w*\b/,
  /\b(?:kill|killing|harm|harming|hurt|hurting|cut|cutting|shoot|shooting|stab|stabbing|hang|hanging|drown|drowning|poison|poisoning|suffocat\w*) myself\b/,
  /\b(?:end|take) my (?:own )?life\b/,
  /\b(?:thinking (?:about|of)|considering|decided to) end(?:ing)? my (?:own )?life\b/,
  /\b(?:going to|want to|plan to|planning to|intend to|thinking (?:about|of)) overdose\b/,
  /\b(?:want|wanna|plan|planning|intend|intending) to (?:die|be dead)\b/,
  /\bi (?:don't|do not) want to (?:be here|live|exist|wake up)\b/,
  /\bi (?:can't|cannot|don't think i can|do not think i can) (?:go on|keep living)(?: anymore)?\b/,
  /\bi(?:'d| would) rather be dead\b/,
  /\bi(?:'m| am| would be) better off dead\b/,
  /\bi wish i (?:was|were) dead\b/,
  /\bi wish i (?:wasn't|weren't|was not|were not) alive\b/,
  /\bi (?:wish|hope) i (?:wouldn't|would not|never) wake up\b/,
  /\b(?:no reason to live|nothing to live for|end it all)\b/,
  /\b(?:want|need) (?:it|this|everything) (?:all )?to end\b/,
  /\bi(?:'m| am) (?:going to|gonna|planning to|about to) die(?:\s+(?:tonight|today|soon|now|this (?:morning|afternoon|evening|weekend))\b|\s+(?:because i (?:can't|cannot)|and nobody)\b|[.!?]*$)/,
  /\bi(?:'m| am) (?:going to|gonna|planning to|about to) end it(?:\s+(?:tonight|today|soon|now|this (?:morning|afternoon|evening|weekend))\b|\s+(?:because i (?:can't|cannot)|and nobody)\b|[.!?]*$)/,
  /\bi(?:(?:'ve| have) decided to|(?:'m| am) (?:thinking about|considering)) end(?:ing)? it(?:\s+(?:tonight|today|soon|now|this (?:morning|afternoon|evening|weekend))\b|[.!?]*$)/,
  /\bi(?:'m| am) ending it\s+(?:tonight|today|soon|now|this (?:morning|afternoon|evening|weekend))\b/,
  /\bi(?:'m| am) not safe (?:alone|with myself)\b/,
  /\bi (?:can't|cannot|do not think i can|don't think i can) keep myself safe\b/,
  /\b(?:jump|throw myself) off (?:a|the) (?:bridge|roof|building|cliff)\b/,
  /\b(?:overdose on purpose|take all (?:of )?my pills)\b/,
  /\bself.?harm\b/,
];

const CRISIS_NEGATIONS: readonly RegExp[] = [
  /\bi(?:'m| am| feel| was| have been)? not suicid\w*\b/,
  /\bi (?:do not|don't|did not|didn't) (?:feel )?suicid\w*\b/,
  /\bi (?:have|had) no (?:suicidal thoughts|thoughts of suicide)\b/,
  /\bi (?:do not|don't|did not|didn't) (?:want|plan|intend) to (?:die|be dead|kill|hurt|harm|cut|shoot|stab|hang|drown|poison|suffocate|overdose|end (?:it|my (?:own )?life))\b/,
  /\bi(?:'m| am) not (?:going to|planning to|about to) (?:die|overdose|end (?:it|my (?:own )?life)|kill|hurt|harm)\b/,
  /\bi am no longer thinking (?:about|of) (?:dying|overdosing|ending (?:it|my (?:own )?life)|killing|hurting|harming)\b/,
];

function safetyClauses(text: string): readonly string[] {
  return text
    .split(/(?:[,.!?;]+|\b(?:and|but|however|because|after|while|although|yet)\b)/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

const THERAPY_PATTERNS: readonly RegExp[] = [
  /\b(?:therapy|therapist|counsell?or|counselling|counseling|psychotherap\w*|psychiatrist|psychologist)\b/,
  /\bmy (?:mental health|behavio(?:u)?ral health) (?:appointment|session|visit|provider|clinician|professional)\b/,
  /\b(?:appointment|session|visit) with my (?:psychiatrist|psychologist|psychotherapist|therapist|counsell?or|social worker)\b/,
  /\bmy session with\b/,
  /\b(?:in|during|after|before|from) my session\b[^.!?]{0,160}\b(?:discuss(?:ed|ing)?|talk(?:ed|ing)?|process(?:ed|ing)?|work(?:ed|ing)? (?:on|through)|covered)\b/,
  /\b(?:discuss(?:ed|ing)?|talk(?:ed|ing)?|process(?:ed|ing)?|work(?:ed|ing)? (?:on|through)|covered)\b[^.!?]{0,160}\b(?:in|during) my session\b/,
];

/** Crisis wins when both boundaries match: it routes out and still stores no wording. */
export function classifySensitiveContent(input: string): SensitiveRuleId | null {
  const text = normalize(input);
  if (
    safetyClauses(text).some(
      (clause) =>
        !CRISIS_NEGATIONS.some((pattern) => pattern.test(clause)) &&
        CRISIS_PATTERNS.some((pattern) => pattern.test(clause)),
    )
  ) {
    return "crisis";
  }
  if (THERAPY_PATTERNS.some((pattern) => pattern.test(text))) return "therapy-content";
  return null;
}

/** Defense in depth for persistence and history reads. */
export function redactSensitiveContent(input: string): string {
  const ruleId = classifySensitiveContent(input);
  return ruleId ? SENSITIVE_REDACTION[ruleId] : input;
}

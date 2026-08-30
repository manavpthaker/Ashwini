/**
 * The non-terminal guidance rules.
 *
 * These sit below every safety rule in the pipeline. They may recommend within
 * the low-risk, reversible domains PRD 4.4 permits — meal timing, protein and
 * hydration habits, training volume, exercise selection, sleep routines — and
 * they are gated, so a contaminated window downgrades them to a data-quality
 * block rather than a recommendation (PRD 11.5).
 */

import type { Rule, RuleContext, RuleOutcome } from "../rule";
import {
  attributedHealthClauses,
  containsWord,
  isOwnerHealthClause,
  mentionedMedications,
} from "../rule";
import { formatList } from "../../text";

const KNOWN_SUPPLEMENTS = [
  "creatine",
  "magnesium",
  "zinc",
  "iron",
  "vitamin d",
  "vitamin c",
  "vitamin b12",
  "b12",
  "omega 3",
  "omega-3",
  "fish oil",
  "ashwagandha",
  "melatonin",
  "caffeine",
  "protein powder",
  "whey",
  "collagen",
  "beta alanine",
  "citrulline",
  "electrolytes",
] as const;

const SUPPLEMENT_SUBJECT = /\b(supplement|supplements|supplement stack|stack)\b/;

const SUPPLEMENT_DECISION_INTENT =
  /\b(should i|can i|could i|would it|is it (?:safe|ok|okay|worth)|are they (?:safe|ok|okay)|worth taking|thinking about (?:taking|adding|starting)|considering (?:taking|adding|starting)|(?:want|plan|planning) to (?:take|add|start))\b/;

const MSK_SYMPTOM =
  /\b(pain(?:ful)?|hurts?|hurting|sore|soreness|ache|aching|aches|injur\w*|strain\w*|sprain\w*|tweak\w*|pull(?:ed)? (?:a )?muscle|stiff(?:ness)?)\b/;

const MSK_RESOLVED =
  /\b(no (?:more )?pain|pain(?: is|'s) gone|pain.?free|doesn'?t hurt|does not hurt)\b/;

const MSK_NON_CURRENT =
  /\b(?:do not|don't|did not|didn't|am not|i'm not|no longer|never|no|deny|denies|denied)\b[^.?!]{0,40}\b(?:hurt|harm|pain|soreness|ache|injury)\b|\b(?:if|what if|in case)\b[^.?!]{0,80}\b(?:hurt|harm|pain|soreness|ache|injury)\b|\b(?:might|may|could|would)\b[^.?!]{0,80}\b(?:hurt|harm|pain|soreness|injury)\b/;

const NUTRITION_OCCURRENCE =
  /(?:\b(?:i|we) (?:just )?(?:ate|had|finished)\b[^.?!]{0,100}\b(?:breakfast|lunch|dinner|snack|meal|food|dal|rice|sandwich|salad|yogurt|eggs?|chicken|shake|oats?|fruit|vegetables?)\b|^(?:just )?(?:ate|had|finished)\b[^.?!]{0,100}\b(?:breakfast|lunch|dinner|snack|meal|food|dal|rice|sandwich|salad|yogurt|eggs?|chicken|shake|oats?|fruit|vegetables?)\b|\b(?:i|we)(?:'ve| have) eaten\b[^.?!]{0,100}\b(?:breakfast|lunch|dinner|snack|meal|food|dal|rice|sandwich|salad|yogurt|eggs?|chicken|shake|oats?|fruit|vegetables?)\b|\b(?:breakfast|lunch|dinner|snack) was (?:late|early)\b|^(?:breakfast|lunch|dinner|snack)\s*[:—-])/;

const NUTRITION_NON_OCCURRENCE =
  /\b(skipped|skip|missed|didn'?t eat|did not eat|haven'?t eaten|have not eaten|plan(?:ned|ning)?(?: to)?|going to (?:eat|have)|will (?:eat|have)|should i|could i|how much|later|tomorrow)\b/;

const PRE_TRAINING_NUTRITION =
  /\b(?:what|which|how much|should i|could i|can i)\b[^.?!]{0,80}\b(?:eat|food|meal|snack|protein|carb(?:s|ohydrate)?)\b[^.?!]{0,80}\b(?:before|pre[- ]?)\s*(?:training|workout|gym|run|session)\b|\b(?:before|pre[- ]?)\s*(?:training|workout|gym|run|session)\b[^.?!]{0,80}\b(?:what|which|how much|should i|could i|can i)\b[^.?!]{0,80}\b(?:eat|food|meal|snack|protein|carb(?:s|ohydrate)?)\b/;

const GENERIC_MEAL_ONLY =
  /^(?:(?:i|we)\s+)?(?:just\s+)?(?:ate|had|finished)(?:\s+(?:my|our))?\s+(?:breakfast|lunch|dinner|snack|meal)(?:\s+(?:(?:at|around)\s+(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?|noon|midnight)|(?:this\s+)?(?:morning|afternoon|evening)|today|tonight|earlier|recently|just now|early|late|a (?:little )?while ago|(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten) (?:minutes?|hours?) ago))?(?:\s+today)?[.!]?$/i;

const CORRECTION_PREFIX = /^\s*correction\s*:\s*/i;
const CORRECTION_SEPARATOR = /\s+[—–]\s+|\s+-\s+/;

const MEAL_PORTION =
  /\b(?:(?:about|around|roughly|approximately|nearly)\s+)?(?:\d+(?:\.\d+)?|half|quarter|one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s*(?:g|grams?|kg|kilograms?|oz|ounces?|ml|millilit(?:er|re)s?|cups?|bowls?|plates?|slices?|pieces?|servings?|portions?|handfuls?|spoons?|tablespoons?|teaspoons?|tbsp|tsp|eggs?)\b|\b(?:small|medium|large)\s+(?:bowl|plate|serving|portion|piece|slice|handful)\b/i;

const DURATION_AMOUNT = String.raw`(?:\d+(?:\.\d+)?|half(?:\s+an?)?|quarter(?:\s+of\s+an?)?|one|two|three|four|five|six|seven|eight|nine|ten|an?)`;
const DURATION_UNIT = String.raw`(?:minutes?|mins?|hours?|hrs?)`;
const DURATION = String.raw`${DURATION_AMOUNT}\s*${DURATION_UNIT}`;
const APPROXIMATE_DURATION = String.raw`(?:(?:about|around|roughly|approximately)\s+)?${DURATION}`;
const CLOCK_TIME = String.raw`(?:at|around)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)`;
const TRAINING_REFERENCE = String.raw`(?:training|workout|gym|run|session)`;

const DIRECT_RELATIVE_TIMING = new RegExp(
  String.raw`^(?:in\s+)?(${APPROXIMATE_DURATION})[.!]?$`,
  "i",
);
const DIRECT_CLOCK_TIMING = new RegExp(String.raw`^(${CLOCK_TIME})[.!]?$`, "i");
const TRAINING_THEN_RELATIVE_TIMING = new RegExp(
  String.raw`\b${TRAINING_REFERENCE}\b(?:\s+(?:starts?|begins?|is))?\s+(?:in|after)\s+(${APPROXIMATE_DURATION})\b`,
  "i",
);
const RELATIVE_TIMING_THEN_TRAINING = new RegExp(
  String.raw`\b(${APPROXIMATE_DURATION})\s+(?:until|before)\s+${TRAINING_REFERENCE}\b`,
  "i",
);
const TRAINING_CLOCK_TIMING = new RegExp(
  String.raw`\b${TRAINING_REFERENCE}\b(?:\s+(?:starts?|begins?|is))?\s+(${CLOCK_TIME})\b`,
  "i",
);

const CLINICAL_NUTRITION_RESTRICTION =
  /\b(?:i|we)(?:'m|'re| am| are| have| had)?\b[^.?!]{0,30}\b(?:diabet(?:es|ic)|kidney disease|renal disease|celiac|coeliac|gastroparesis|food allerg(?:y|ies|ic)|allergic to|clinician[- ](?:directed|prescribed) diet|medically prescribed diet)\b|\bmy (?:doctor|clinician|dietitian|prescriber) (?:gave|set|prescribed|requires?)\b[^.?!]{0,40}\b(?:diet|nutrition|food|meal)\b/i;

const TRAINING_DECISION_INTENT =
  /\b(?:should|can|could|do) i (?:still )?(?:train|work\s*out|lift|run|do (?:my|the) (?:workout|session))\b|\bshould i (?:skip|cancel|modify|change|reduce|shorten) (?:training|the gym|my workout|my session|the workout|the session)\b|\bdo i need to (?:adjust|change|modify|skip|reduce) (?:training|my workout|my session|the workout|the session)\b|\bis it (?:okay|ok|safe|reasonable) (?:for me )?to (?:train|work\s*out|lift|run)\b|\bhow should i (?:handle\s+)?(?:training|my workout|my session|the workout|the session)\b|\bwhat should i do (?:about|with|for) (?:training|my workout|my session|the workout|the session)\b|\b(?:help me|need to) decide (?:how to handle|whether to do|whether i should do) (?:training|my workout|my session|the workout|the session)\b/i;

const TRAINING_ILLNESS =
  /\b(?:i\s+(?:feel|am)|i'm|i am feeling)\s+(?:sick|ill|unwell)\b|\b(?:feeling|feel)\s+(?:sick|ill|unwell)\b/i;
const TRAINING_SCHEDULE_CHANGE =
  /\b(?:(?:my|the)\s+)?(?:schedule|plans?)\s+(?:has\s+)?(?:changed|shifted)\b/i;
const TRAINING_TIME_CONSTRAINT = new RegExp(
  String.raw`\b(?:i\s+)?only\s+have\s+(${APPROXIMATE_DURATION})\b|\b(?:i\s+have|i've\s+got)\s+only\s+(${APPROXIMATE_DURATION})\b|\b(?:short|limited)\s+on\s+time\b`,
  "i",
);

interface PreTrainingTiming {
  readonly lead: string;
  readonly retained: string;
  readonly expectedLag: string;
}

type TrainingConstraint =
  | { readonly kind: "illness" }
  | { readonly kind: "schedule" }
  | { readonly kind: "time"; readonly duration: string | null };

function withoutCorrectionPrefix(text: string): string {
  return text.replace(CORRECTION_PREFIX, "").trim();
}

function correctionDetails(text: string): readonly string[] {
  const parts = withoutCorrectionPrefix(text)
    .split(CORRECTION_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts.slice(1) : [];
}

function mealDetailsFrom(text: string): { description: string | null; hasPortion: boolean } {
  const retained = withoutCorrectionPrefix(text);
  const parts = retained
    .split(CORRECTION_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);
  // A non-empty check-in always yields at least one split part. The rule only
  // calls this extractor after matching an actual meal occurrence.
  const base = parts[0]!;
  const details = parts.slice(1);
  const hasPortion = MEAL_PORTION.test(retained);

  if (GENERIC_MEAL_ONLY.test(base)) {
    const hasFoodDescription = details.some((detail) => !MEAL_PORTION.test(detail));
    return {
      description: hasFoodDescription ? details.join(" — ") : null,
      hasPortion,
    };
  }

  return { description: retained, hasPortion };
}

function relativePreTrainingTiming(duration: string): PreTrainingTiming {
  return {
    lead: `With ${duration} until training`,
    retained: `${duration} until training`,
    expectedLag: duration,
  };
}

function clockPreTrainingTiming(clock: string): PreTrainingTiming {
  return {
    lead: `With training ${clock}`,
    retained: `training ${clock}`,
    expectedLag: `Training ${clock}`,
  };
}

function directPreTrainingTimingFrom(detail: string): PreTrainingTiming | null {
  const clock = detail.match(DIRECT_CLOCK_TIMING)?.[1];
  if (clock) return clockPreTrainingTiming(clock);

  const duration = detail.match(DIRECT_RELATIVE_TIMING)?.[1];
  return duration ? relativePreTrainingTiming(duration) : null;
}

function preTrainingTimingFrom(text: string): PreTrainingTiming | null {
  const correctionTiming = [...correctionDetails(text)]
    .reverse()
    .map(directPreTrainingTimingFrom)
    .find((timing): timing is PreTrainingTiming => timing !== null);
  if (correctionTiming) return correctionTiming;

  const retained = withoutCorrectionPrefix(text);
  const clock = retained.match(TRAINING_CLOCK_TIMING)?.[1];
  if (clock) return clockPreTrainingTiming(clock);

  const duration =
    retained.match(TRAINING_THEN_RELATIVE_TIMING)?.[1] ??
    retained.match(RELATIVE_TIMING_THEN_TRAINING)?.[1];
  return duration ? relativePreTrainingTiming(duration) : null;
}

function trainingConstraintFrom(context: RuleContext): TrainingConstraint | null {
  const ownerClauses = attributedHealthClauses(context.text).filter(isOwnerHealthClause);

  if (ownerClauses.some((clause) => TRAINING_ILLNESS.test(clause.text))) {
    return { kind: "illness" };
  }

  for (const clause of ownerClauses) {
    const timeConstraint = clause.text.match(TRAINING_TIME_CONSTRAINT);
    if (timeConstraint) {
      return { kind: "time", duration: timeConstraint[1] ?? timeConstraint[2] ?? null };
    }
  }

  if (ownerClauses.some((clause) => TRAINING_SCHEDULE_CHANGE.test(clause.text))) {
    return { kind: "schedule" };
  }

  return null;
}

function hasOwnerClinicalNutritionRestriction(context: RuleContext): boolean {
  return attributedHealthClauses(context.text).some(
    (clause) => isOwnerHealthClause(clause) && CLINICAL_NUTRITION_RESTRICTION.test(clause.text),
  );
}

const RECOVERY =
  /\b(flat|tired|exhausted|knackered|wiped|drained|low energy|no energy|sluggish|sleepy|fatigued?|didn'?t sleep|did not sleep|bad sleep|poor sleep|slept badly|rough night|run down)\b/;

const MEDICATION =
  /\b(refill|pharmacy|adherence|medication|medications|meds|medicine|medicines|pill|pills|tablet|tablets|prescription|dose)\b/;

const MEDICATION_EVENT_ACTION =
  /\b(?:(?:i|we)\s+)?(?:just\s+)?(?:took|have taken|swallowed|ingested|missed|forgot)\b|\b(?:picked up|refilled)\b/;

const MEDICATION_QUESTION =
  /\b(?:did|have|has|should|can|could|would|may|might)\s+(?:i|we)\b[^.?!]{0,45}\b(?:take|taken|swallow|use)\b/;

const MEDICATION_TOPIC_QUESTION =
  /\b(?:have|had|got)\s+(?:a|another|one)\s+question\b|\b(?:question|questions)\s+about\b/;

const MEDICATION_MEMORY_ONLY =
  /\bforgot\s+(?:which|what|the name of)\b[^.?!]{0,45}\b(?:medication|medicine|meds|pill|tablet|prescription)\b/;

const DRUGLIKE_MEDICATION =
  /\b(?:ibuprofen|advil|motrin|tylenol|acetaminophen|paracetamol|aspirin|naproxen|aleve|benadryl|zyrtec|claritin|melatonin|\w*(?:pril|sartan|olol|statin|azole|cillin|mycin|oxetine|azepam|zolam|tidine|parin|gliptin|glutide|tinib|formin|prazole))\b/;

const RECOVERY_NON_CURRENT =
  /\b(?:might|may|could|would)\b[^.?!]{0,80}\b(?:tired|fatigued|flat|low energy|no energy|sleepy)\b|\b(?:tired|fatigued|flat|low energy|no energy|sleepy)\b[^.?!]{0,40}\b(?:tomorrow|later|next week)\b|\b(?:used to (?:be|feel)|felt|was)\b[^.?!]{0,35}\b(?:tired|fatigued|flat|low energy|no energy|sleepy)\b[^.?!]{0,35}\b(?:last (?:week|month|year)|\d+ (?:days?|weeks?|months?|years?) ago|in the past)\b/;

const RECOVERY_NEGATED =
  /\b(?:not|never|no longer) (?:feeling |feel )?(?:flat|tired|exhausted|wiped|drained|sleepy|fatigued|run down|low energy)\b|\b(?:do not|don't|did not|didn't) (?:feel|have) (?:flat|tired|exhausted|wiped|drained|sleepy|fatigued|run down|low energy|no energy|bad sleep|poor sleep)\b|\b(?:have not|haven't) (?:felt|been feeling) (?:flat|tired|exhausted|wiped|drained|sleepy|fatigued|run down|low energy|no energy)\b|\b(?:did not|didn't|have not|haven't) (?:sleep|slept) (?:badly|poorly)\b|\b(?:am not|i'm not) (?:flat|tired|exhausted|wiped|drained|sleepy|fatigued|run down|low energy)\b/;
const MEDICATION_NON_EVENT =
  /\b(?:do not|don't|did not|didn't|have not|haven't|am not|i'm not|never)\b[^.?!]{0,60}\b(?:change|increase|decrease|raise|lower|double|halve|split|stop|skip|switch|taper|take|taking|swallow|ingest|overdose)\w*\b[^.?!]{0,40}\b(?:medications?|meds|medicines?|pills?|tablets?|prescriptions?|doses?)\b/;

function medicationIdentityFromCorrection(text: string): string | null {
  const detail = correctionDetails(text).at(-1)?.trim();
  if (!detail || /\b(?:not sure|unknown|don't know|do not know)\b/i.test(detail)) return null;
  if (!/^[a-z][a-z0-9 .'-]{1,79}$/i.test(detail)) return null;
  return detail;
}

function medicationIdentityFromEvent(text: string): string | null {
  const match = withoutCorrectionPrefix(text).match(
    /\b(?:took|have taken|swallowed|ingested|missed|forgot(?: to take)?|picked up|refilled)\s+(?:my\s+)?([a-z][a-z0-9'-]{2,39})\b/i,
  );
  const candidate = match?.[1] ?? null;
  if (
    !candidate ||
    /^(?:morning|evening|night|daily|usual|medication|medicine|meds|pill|pills|tablet|tablets|dose)$/i.test(
      candidate,
    )
  ) {
    return null;
  }
  return DRUGLIKE_MEDICATION.test(candidate) ? candidate : null;
}

function hasCurrentRecoverySignal(context: RuleContext): boolean {
  return attributedHealthClauses(context.text).some(
    (clause) =>
      RECOVERY.test(clause.text) &&
      !RECOVERY_NEGATED.test(clause.text) &&
      !RECOVERY_NON_CURRENT.test(clause.text) &&
      isOwnerHealthClause(clause),
  );
}

function mealKindFrom(text: string): "breakfast" | "lunch" | "dinner" | "snack" | null {
  if (containsWord(text, "breakfast")) return "breakfast";
  if (containsWord(text, "lunch")) return "lunch";
  if (containsWord(text, "dinner")) return "dinner";
  if (containsWord(text, "snack")) return "snack";
  return null;
}

function bodyRegionFrom(text: string): string | null {
  const regions = [
    "shoulder",
    "knee",
    "back",
    "hip",
    "elbow",
    "wrist",
    "ankle",
    "neck",
    "hamstring",
    "calf",
    "groin",
    "achilles",
  ];
  return regions.find((region) => containsWord(text, region)) ?? null;
}

function mentionedSupplements(context: RuleContext): readonly string[] {
  const pool = [
    ...KNOWN_SUPPLEMENTS,
    ...context.input.context.supplements.map((s) => s.toLowerCase()),
  ];
  return [...new Set(pool.filter((name) => containsWord(context.text, name)))];
}

function subjectKey(item: string): string {
  return item.trim().toLowerCase();
}

function uniqueSubjects(items: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = subjectKey(item);
    if (key.length === 0 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * PRD 11.7: "Supplement interaction recommendations require a current authorized
 * source result." PRD 7.3: "Never: infer safety from silence."
 *
 * The prototype's version of this rule invented a recommendation and claimed to
 * have "queued" a query that did not exist. This one reads the results it was
 * given and blocks when there are none.
 */
export const supplementInteractionRule: Rule = {
  id: "supplement-interaction",
  matches: (context) =>
    attributedHealthClauses(context.text).some((clause) => {
      if (!isOwnerHealthClause(clause)) return false;
      const clauseContext = { ...context, text: clause.text };
      const hasSubject =
        mentionedSupplements(clauseContext).length > 0 || SUPPLEMENT_SUBJECT.test(clause.text);
      return hasSubject && SUPPLEMENT_DECISION_INTENT.test(clause.text);
    }),
  apply: (context) => {
    const supplements = mentionedSupplements(context);
    const currentMedications = context.input.context.medications.map((m) => m.name);
    const subjects = uniqueSubjects([...supplements, ...currentMedications]);

    const fresh = context.input.context.interactionResults.find((result) => {
      const notExpired = result.expiresAt === null || result.expiresAt > context.input.now;
      const covers = subjects.every((item) =>
        result.items.some((covered) => subjectKey(covered) === subjectKey(item)),
      );
      return notExpired && covers && supplements.length > 0;
    });

    if (!fresh) {
      return {
        domain: "medication",
        evidenceStatus: "unusable",
        ladderLevel: 1,
        decisionType: "data_quality_block",
        route: null,
        reply: {
          text: `I can't answer that safely yet. A supplement recommendation needs a current interaction check against everything you're already taking, and I don't have one${subjects.length > 0 ? ` covering ${formatList(subjects, "these items")}` : ""}. No result means no answer, not a quiet all-clear. No interaction-check runner is connected yet, so this remains unanswered.`,
          kind: "question",
          receipt: "Blocked · no current authorized interaction result",
        },
        records:
          subjects.length > 0 ? [{ kind: "interaction_check_request", items: subjects }] : [],
        followUp: null,
        confidenceNote:
          "No authorized interaction result was available for this item set. PRD 7.3 forbids inferring safety from silence.",
        refused:
          "Ashwini will not say whether this supplement is safe to add without a current cited source result.",
        choices: ["I’ll ask a pharmacist", "Do nothing for now"],
        target: null,
        expectedLag: null,
        gated: false,
        gateOverride: {
          outcome: "blocked",
          reason: "No current authorized interaction result covers this item set.",
          checked: [],
        },
      };
    }

    return {
      domain: "medication",
      evidenceStatus: "rule_based",
      ladderLevel: 2,
      decisionType: "recommendation",
      route: null,
      reply: {
        text: `${fresh.summary} That comes from ${fresh.provider}, checked ${fresh.checkedAt.toISOString().slice(0, 10)}${fresh.evidenceGrade ? `, graded ${fresh.evidenceGrade}` : ""}. It covers supplement interactions only — anything involving two prescriptions goes to your pharmacist.`,
        kind: "recommendation",
        receipt: `Cited · ${fresh.provider}`,
      },
      records: [],
      followUp: null,
      confidenceNote: `Based on a current ${fresh.provider} result for ${formatList(fresh.items, "these items")}.`,
      refused:
        "Ashwini will not extend this result to drug–drug interactions, efficacy, or dosing.",
      choices: ["I plan to add it", "I plan to hold off", "Do nothing for now"],
      target: null,
      expectedLag: null,
      gated: true,
    };
  },
};

export const musculoskeletalRule: Rule = {
  id: "symptom-msk",
  matches: ({ text }) =>
    attributedHealthClauses(text).some(
      (clause) =>
        MSK_SYMPTOM.test(clause.text) &&
        !MSK_RESOLVED.test(clause.text) &&
        !MSK_NON_CURRENT.test(clause.text) &&
        !/\b(?:used to have|previously had)\b[^.?!]{0,40}\b(?:pain|soreness|ache|injury|stiff(?:ness)?)\b|\b(?:pain|soreness|ache|injury|hurt|stiff(?:ness)?)\b[^.?!]{0,40}\b(?:yesterday|last (?:week|month|year)|(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten) (?:days?|weeks?|months?|years?) ago)\b/.test(
          clause.text,
        ) &&
        isOwnerHealthClause(clause),
    ),
  apply: (context) => ({
    domain: "training",
    evidenceStatus: "rule_based",
    ladderLevel: 2,
    decisionType: "recommendation",
    route: null,
    reply: {
      text: "I would avoid loading the painful movement for now rather than test it under load. If this is new, getting worse, or limiting normal movement, contact an appropriate clinician; Ashwini can retain context, but it cannot assess the cause or prescribe rehabilitation.",
      kind: "recommendation",
      receipt: "Training adjustment recorded · clinical boundary stated",
    },
    records: [
      {
        kind: "symptom",
        text: context.input.utterance.text,
        bodyRegion: bodyRegionFrom(context.text),
      },
    ],
    followUp: null,
    confidenceNote: "Based on your report alone. No assessment of the underlying cause was made.",
    refused:
      "Ashwini will not diagnose an injury, judge technique from text, or prescribe rehabilitation.",
    choices: [
      "I plan to swap the session",
      "I plan to avoid the painful movement",
      "I’ll contact a physio",
    ],
    target: "Choose how to handle the saved session",
    expectedLag: "Same day",
    // Avoiding a movement that currently hurts is a reversible operational
    // boundary, not a diagnosis or personal-effect verdict. Missing longitudinal
    // confound evaluations therefore qualify the advice rather than erase it.
    gated: false,
    gateOverride: {
      outcome: "caveated",
      reason: "Based on the current self-report only; cause and severity were not assessed.",
      checked: [],
    },
  }),
};

export const preTrainingNutritionRule: Rule = {
  id: "pre-training-nutrition",
  matches: ({ text }) =>
    attributedHealthClauses(text).some(
      (clause) => PRE_TRAINING_NUTRITION.test(clause.text) && isOwnerHealthClause(clause),
    ),
  apply: (context) => {
    if (hasOwnerClinicalNutritionRestriction(context)) {
      return {
        domain: "nutrition",
        evidenceStatus: "route_out",
        ladderLevel: 5,
        decisionType: "route_out",
        route: "clinician",
        reply: {
          text: "A generic pre-training food rule should not override the medical restriction you named. Use the clinician-authored plan already given to you, or ask the appropriate clinician or dietitian before changing food or timing. Ashwini has not selected a food, portion, or target from this check-in.",
          kind: "route",
          receipt: "Clinical nutrition boundary · no generic food advice issued",
        },
        records: [{ kind: "context_note", text: "Clinical nutrition route-out issued." }],
        followUp: null,
        confidenceNote:
          "A user-reported medical nutrition restriction makes generic pre-training guidance inappropriate.",
        refused:
          "Ashwini will not override a clinician-directed diet or prescribe nutrition for diabetes, kidney disease, allergy, or gastrointestinal disease.",
        choices: [],
        target: null,
        expectedLag: null,
        gated: false,
      };
    }

    const timing = preTrainingTimingFrom(context.input.utterance.text);
    if (!timing) {
      return {
        domain: "nutrition",
        evidenceStatus: "rule_based",
        ladderLevel: 2,
        decisionType: "recommendation",
        route: null,
        reply: {
          text: "Timing changes the practical answer, so I will not recommend a food or portion yet. How long until training starts? Give the time in minutes or hours. If a clinician-directed diet, diabetes, kidney disease, food allergy, or gastrointestinal restriction applies, use that plan instead of generic guidance.",
          kind: "question",
          receipt: "Rule-based intake boundary · timing needed before advice",
        },
        records: [],
        followUp: null,
        confidenceNote:
          "A rule-based intake boundary: timing is required before a bounded pre-training option can be offered.",
        refused:
          "Ashwini will not invent a food, portion, calorie target, or medical nutrition plan without the timing and relevant restrictions.",
        choices: [],
        target: "Add the timing that determines the practical food choice",
        expectedLag: "Before the session",
        gated: false,
        gateOverride: {
          outcome: "caveated",
          reason:
            "No food recommendation was made; session timing and personal tolerance are still incomplete.",
          checked: [],
        },
      };
    }

    return {
      domain: "nutrition",
      evidenceStatus: "rule_based",
      ladderLevel: 2,
      decisionType: "recommendation",
      route: null,
      reply: {
        text: `${timing.lead}, the bounded option is to avoid experimenting: use only a food or drink you already know you tolerate, if you want one, and keep any clinician-directed restriction in control. I cannot choose a food or portion from this record alone.`,
        kind: "recommendation",
        receipt: `Caveated pre-training option · ${timing.retained} retained`,
      },
      records: [],
      followUp: null,
      confidenceNote:
        "A conservative operational rule based on the timing you supplied; personal tolerance and clinical restrictions were not established.",
      refused:
        "Ashwini will not choose a personalized food, portion, calorie target, or medical nutrition plan from timing alone.",
      choices: ["Use only a familiar tolerated option", "Do nothing for now"],
      target: "Choose the conservative pre-training option",
      expectedLag: timing.expectedLag,
      gated: false,
      gateOverride: {
        outcome: "caveated",
        reason:
          "Timing is known, but personal tolerance and clinical nutrition restrictions were not established.",
        checked: [],
      },
    };
  },
};

export const nutritionRule: Rule = {
  id: "nutrition",
  matches: ({ text }) =>
    attributedHealthClauses(text).some(
      (clause) =>
        NUTRITION_OCCURRENCE.test(clause.text) &&
        !NUTRITION_NON_OCCURRENCE.test(clause.text) &&
        isOwnerHealthClause(clause),
    ),
  apply: (context) => {
    const { description, hasPortion } = mealDetailsFrom(context.input.utterance.text);
    const needsFoodDescription = description === null;
    const needsPortion = description !== null && !hasPortion;
    return {
      domain: "nutrition",
      evidenceStatus: "recorded",
      ladderLevel: 0,
      decisionType: "recommendation",
      route: null,
      reply: {
        text: needsFoodDescription
          ? "I recorded that the meal happened without inventing calories or protein. What did you eat? A short description is enough."
          : needsPortion
            ? "I recorded the meal and the foods you named without inventing calories or protein. Roughly how much did you have? A household measure or plain-language portion is enough."
            : "I recorded the food description and portion exactly as you supplied them. I did not turn that wording into calories, protein, or a precise nutrition estimate.",
        kind: needsFoodDescription || needsPortion ? "question" : "record",
        receipt: needsFoodDescription
          ? "Meal occurrence recorded · food detail still unknown"
          : needsPortion
            ? "Meal description recorded · portion still unknown"
            : "Meal description and portion recorded · no nutrition estimate inferred",
      },
      records: [{ kind: "meal", mealKind: mealKindFrom(context.text), description }],
      followUp: null,
      confidenceNote: needsFoodDescription
        ? "Only the meal occurrence is known. No nutrition range was estimated from this text."
        : needsPortion
          ? "The occurrence and your own food description are known; portion and nutrition ranges remain unknown."
          : "The occurrence, description, and plain-language portion come from the user; nutrition values remain unknown.",
      refused: "Ashwini will not present a text description as an exact calorie or protein figure.",
      choices: [],
      target:
        needsFoodDescription || needsPortion
          ? "Add one detail to make this meal record useful"
          : "Meal detail recorded without a fabricated estimate",
      expectedLag: null,
      gated: false,
    };
  },
};

function recoveryOutcome(context: RuleContext): RuleOutcome {
  const hasTrainingCommitment = context.input.context.commitments.some(
    (commitment) => commitment.domain === "training",
  );

  if (!hasTrainingCommitment) {
    return {
      domain: "training",
      evidenceStatus: "rule_based",
      ladderLevel: 2,
      decisionType: "recommendation",
      route: null,
      reply: {
        text: "I recorded the low-energy or sleep context. There is no saved session to modify, so I am not inventing one. For today, keep optional effort flexible rather than forcing a normal-volume assumption; this check-in does not establish why your energy is low.",
        kind: "recommendation",
        receipt: "Recovery context recorded · optional effort kept flexible",
      },
      records: [{ kind: "context_note", text: context.input.utterance.text }],
      followUp: null,
      confidenceNote:
        "A conservative same-day choice from your self-report, with no saved training commitment attached.",
      refused:
        "Ashwini will not fabricate a session, diagnose the low energy, or claim a measured recovery effect.",
      choices: ["Keep optional effort flexible today", "Do nothing for now"],
      target: "Choose how much this recovery signal changes today",
      expectedLag: "Today",
      gated: false,
      gateOverride: {
        outcome: "caveated",
        reason: "Based on the current self-report; cause and recovery status were not measured.",
        checked: [],
      },
    };
  }

  return {
    domain: "training",
    evidenceStatus: "rule_based",
    ladderLevel: 3,
    decisionType: "recommendation",
    route: null,
    reply: {
      text: "That changes the volume call for the saved training commitment. I would favor the lower-volume option unless energy clearly comes back; the session remains optional.",
      kind: "recommendation",
      receipt: "Training commitment · reduced volume favoured",
    },
    records: [],
    followUp: null,
    confidenceNote:
      "A working synthesis from your reported state and a saved training commitment, not a measured recovery finding.",
    refused:
      "Ashwini will not attribute this to a medical cause or claim a recovery effect it has not measured.",
    choices: ["Reduced volume", "Full session", "Do nothing for now"],
    target: "Choose a volume for the saved training commitment",
    expectedLag: "Same day",
    gated: true,
  };
}

function constrainedTrainingOutcome(
  context: RuleContext,
  constraint: TrainingConstraint,
): RuleOutcome {
  const shared = {
    domain: "training" as const,
    evidenceStatus: "rule_based" as const,
    ladderLevel: 2 as const,
    decisionType: "recommendation" as const,
    route: null,
    records: [{ kind: "context_note" as const, text: context.input.utterance.text }],
    followUp: null,
    expectedLag: "Today",
    gated: false,
    gateOverride: {
      outcome: "caveated" as const,
      reason: "A bounded same-day choice based only on the constraint the user reported.",
      checked: [],
    },
  };

  if (constraint.kind === "illness") {
    return {
      ...shared,
      reply: {
        text: "You said you feel sick today. The bounded choice is not to force optional training: skip it today and reassess when you feel well. This does not diagnose the illness or establish when strenuous exercise is medically safe.",
        kind: "recommendation",
        receipt: "Illness context retained · optional training not forced",
      },
      confidenceNote:
        "A conservative same-day choice from the reported illness context; symptoms and severity were not established.",
      refused:
        "Ashwini will not diagnose the illness, clear strenuous exercise, or infer symptoms that were not reported.",
      choices: ["Skip optional training today", "Do nothing for now"],
      target: "Choose whether to skip optional training today",
    };
  }

  if (constraint.kind === "time") {
    const availableTime = constraint.duration ? `only ${constraint.duration}` : "limited time";
    return {
      ...shared,
      reply: {
        text: `With ${availableTime} available, the bounded choice is a shorter familiar version of the session or skipping it today. I am not selecting exercises, load, or intensity from this check-in.`,
        kind: "recommendation",
        receipt: constraint.duration
          ? `Time constraint retained · ${constraint.duration} available`
          : "Time constraint retained · short-session choice offered",
      },
      confidenceNote:
        "A logistical choice from the reported time constraint, not a claim about readiness or training effect.",
      refused:
        "Ashwini will not invent a workout, exercise selection, load, intensity, or expected training effect.",
      choices: ["Do a short familiar session", "Skip it today", "Do nothing for now"],
      target: "Choose how to handle the limited training time",
    };
  }

  return {
    ...shared,
    reply: {
      text: "You said the schedule changed, not that your health or capacity changed. The bounded choice is to move the optional session or skip it today; I do not have enough detail to prescribe a replacement session.",
      kind: "recommendation",
      receipt: "Schedule change retained · move-or-skip choice offered",
    },
    confidenceNote:
      "A logistical choice from the reported schedule change, not a claim about readiness or training effect.",
    refused:
      "Ashwini will not invent a replacement session, training constraint, or change in physical capacity.",
    choices: ["Move the session", "Skip it today", "Do nothing for now"],
    target: "Choose how to handle the changed schedule",
  };
}

export const trainingDecisionRule: Rule = {
  id: "training-decision",
  matches: ({ text }) =>
    attributedHealthClauses(text).some(
      (clause) => TRAINING_DECISION_INTENT.test(clause.text) && isOwnerHealthClause(clause),
    ),
  apply: (context) => {
    if (hasCurrentRecoverySignal(context)) return recoveryOutcome(context);
    const constraint = trainingConstraintFrom(context);
    if (constraint) return constrainedTrainingOutcome(context, constraint);

    return {
      domain: "training",
      evidenceStatus: "recorded",
      ladderLevel: 0,
      decisionType: "recommendation",
      route: null,
      reply: {
        text: "I heard the training decision, but I do not yet have the change that should determine it. What changed that should affect training today—pain, sleep, energy, illness, the schedule, or available time?",
        kind: "question",
        receipt: "Training decision retained · one decision-relevant change needed",
      },
      records: [{ kind: "context_note", text: context.input.utterance.text }],
      followUp: null,
      confidenceNote:
        "The user asked for a training decision, but no decision-relevant change was established.",
      refused: "Ashwini will not invent a reason to change training.",
      choices: [],
      target: "Name the change that should affect training",
      expectedLag: "Today",
      gated: false,
    };
  },
};

export const recoveryRule: Rule = {
  id: "training-volume",
  matches: hasCurrentRecoverySignal,
  apply: recoveryOutcome,
};

export const medicationRule: Rule = {
  id: "medication",
  matches: (context) =>
    attributedHealthClauses(context.text).some((clause) => {
      if (
        !isOwnerHealthClause(clause) ||
        MEDICATION_NON_EVENT.test(clause.text) ||
        MEDICATION_QUESTION.test(clause.text) ||
        MEDICATION_TOPIC_QUESTION.test(clause.text) ||
        MEDICATION_MEMORY_ONLY.test(clause.text) ||
        !MEDICATION_EVENT_ACTION.test(clause.text)
      ) {
        return false;
      }
      const clauseContext = { ...context, text: clause.text };
      return (
        MEDICATION.test(clause.text) ||
        DRUGLIKE_MEDICATION.test(clause.text) ||
        mentionedMedications(clauseContext).length > 0
      );
    }),
  apply: (context) => {
    const matches = mentionedMedications(context);
    const suppliedIdentity =
      medicationIdentityFromCorrection(context.input.utterance.text) ??
      medicationIdentityFromEvent(context.input.utterance.text);
    const needsIdentity = matches.length === 0 && suppliedIdentity === null;
    const retainedIdentity =
      matches.length > 0 ? formatList(matches, "the medication you named") : suppliedIdentity;
    return {
      domain: "medication",
      evidenceStatus: "recorded",
      ladderLevel: 0,
      decisionType: "recommendation",
      route: null,
      reply: {
        text: needsIdentity
          ? "I recorded your wording in the protected medication lane, but I cannot safely match it to a scheduled dose yet. Which medication was this? The name is enough; dose or timing advice still belongs with your prescriber or pharmacist."
          : matches.length > 0
            ? `I recorded this medication context against ${retainedIdentity}. I did not infer a scheduled dose, timing change, or effectiveness claim.`
            : `I retained the medication name “${retainedIdentity}” exactly as you supplied it with this event. It is not yet matched to a saved schedule or dose, and I did not infer timing correctness or effectiveness.`,
        kind: needsIdentity ? "question" : "record",
        receipt: needsIdentity
          ? "Protected medication record · medication not yet matched"
          : matches.length > 0
            ? "Protected medication record · named medication retained"
            : "Protected medication record · user-supplied name retained",
      },
      records: [{ kind: "medication_event", text: context.input.utterance.text }],
      followUp: null,
      confidenceNote:
        "A protected medication-context record. No claim is made about dose correctness or effectiveness.",
      refused:
        "Ashwini will not evaluate whether the medication is working or treat it as an experimental variable.",
      choices: [],
      target: needsIdentity
        ? "Add the medication name so the record can be matched safely"
        : matches.length > 0
          ? "Medication context recorded"
          : "Medication name retained without claiming a schedule match",
      expectedLag: null,
      gated: false,
    };
  },
};

export const fallbackRule: Rule = {
  id: "fallback",
  matches: () => true,
  apply: (context) => ({
    domain: "system",
    evidenceStatus: "recorded",
    ladderLevel: 0,
    decisionType: "recommendation",
    route: null,
    reply: {
      text: "I kept this as context without manufacturing a recommendation. If this concerns immediate danger or new, severe, or worsening symptoms, contact emergency services or appropriate human care now. Otherwise, what decision or change do you want help with right now? Name the outcome or the next choice that matters most.",
      kind: "question",
      receipt: "Context retained · one decision needed",
    },
    records: [{ kind: "context_note", text: context.input.utterance.text }],
    followUp: null,
    confidenceNote: "Stored as a recorded fact. PRD 5 level 0: store, and normally stay silent.",
    refused: "Ashwini will not infer a conclusion from an unclassified note.",
    choices: [],
    target: "Name the decision or change that matters now",
    expectedLag: null,
    gated: false,
  }),
};

/**
 * In pipeline order, below every safety rule.
 *
 * `medication` sits above `nutrition` deliberately. PRD 7.3 treats adherence as
 * a protected record, and messages routinely mention both ("took my sertraline
 * with breakfast") — filing that as a meal would lose the dose event.
 */
export const guidanceRules: readonly Rule[] = [
  supplementInteractionRule,
  musculoskeletalRule,
  preTrainingNutritionRule,
  trainingDecisionRule,
  medicationRule,
  nutritionRule,
  recoveryRule,
  fallbackRule,
];

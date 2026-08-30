/**
 * The non-terminal guidance rules.
 *
 * These sit below every safety rule in the pipeline. They may recommend within
 * the low-risk, reversible domains PRD 4.4 permits — meal timing, protein and
 * hydration habits, training volume, exercise selection, sleep routines — and
 * they are gated, so a contaminated window downgrades them to a data-quality
 * block rather than a recommendation (PRD 11.5).
 */

import type { Rule, RuleContext } from "../rule";
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

const RECOVERY =
  /\b(flat|tired|exhausted|knackered|wiped|drained|low energy|no energy|sluggish|sleepy|fatigued?|didn'?t sleep|did not sleep|bad sleep|poor sleep|slept badly|rough night|run down)\b/;

const MEDICATION =
  /\b(refill|pharmacy|adherence|medication|medications|meds|medicine|medicines|pill|pills|tablet|tablets|prescription|dose)\b/;

const RECOVERY_NON_CURRENT =
  /\b(?:might|may|could|would)\b[^.?!]{0,80}\b(?:tired|fatigued|flat|low energy|no energy|sleepy)\b|\b(?:tired|fatigued|flat|low energy|no energy|sleepy)\b[^.?!]{0,40}\b(?:tomorrow|later|next week)\b|\b(?:used to (?:be|feel)|felt|was)\b[^.?!]{0,35}\b(?:tired|fatigued|flat|low energy|no energy|sleepy)\b[^.?!]{0,35}\b(?:last (?:week|month|year)|\d+ (?:days?|weeks?|months?|years?) ago|in the past)\b/;

const RECOVERY_NEGATED =
  /\b(?:not|never|no longer) (?:feeling |feel )?(?:flat|tired|exhausted|wiped|drained|sleepy|fatigued|run down|low energy)\b|\b(?:do not|don't|did not|didn't) (?:feel|have) (?:flat|tired|exhausted|wiped|drained|sleepy|fatigued|run down|low energy|no energy|bad sleep|poor sleep)\b|\b(?:am not|i'm not) (?:flat|tired|exhausted|wiped|drained|sleepy|fatigued|run down|low energy)\b/;
const MEDICATION_NON_EVENT =
  /\b(?:do not|don't|did not|didn't|have not|haven't|am not|i'm not|never)\b[^.?!]{0,60}\b(?:change|increase|decrease|raise|lower|double|halve|split|stop|skip|switch|taper|take|taking|swallow|ingest|overdose)\w*\b[^.?!]{0,40}\b(?:medications?|meds|medicines?|pills?|tablets?|prescriptions?|doses?)\b/;

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
    gated: true,
  }),
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
  apply: (context) => ({
    domain: "nutrition",
    evidenceStatus: "recorded",
    ladderLevel: 0,
    decisionType: "recommendation",
    route: null,
    reply: {
      text: "Recorded that the meal happened. Without a description, recipe, photo, or portion, I did not estimate or store calories or protein. Correct this check-in if you want to add those details; otherwise the record stays occurrence-only.",
      kind: "record",
      receipt: "Meal occurrence recorded · nutrition detail unknown",
    },
    records: [{ kind: "meal", mealKind: mealKindFrom(context.text) }],
    followUp: null,
    confidenceNote:
      "Only the meal occurrence is known. No nutrition range was estimated from this text.",
    refused:
      "Ashwini will not present a photo or text estimate as an exact calorie or protein figure.",
    choices: [],
    target: null,
    expectedLag: null,
    gated: false,
  }),
};

export const recoveryRule: Rule = {
  id: "training-volume",
  matches: ({ text }) =>
    attributedHealthClauses(text).some(
      (clause) =>
        RECOVERY.test(clause.text) &&
        !RECOVERY_NEGATED.test(clause.text) &&
        !RECOVERY_NON_CURRENT.test(clause.text) &&
        isOwnerHealthClause(clause),
    ),
  apply: (context) => {
    const hasTrainingCommitment = context.input.context.commitments.some(
      (commitment) => commitment.domain === "training",
    );

    if (!hasTrainingCommitment) {
      return {
        domain: "training",
        evidenceStatus: "recorded",
        ladderLevel: 0,
        decisionType: "recommendation",
        route: null,
        reply: {
          text: "Recorded the low-energy or sleep context. There is no saved training commitment to modify, so I am not inventing a session or a volume call.",
          kind: "record",
          receipt: "Recovery context recorded · no training plan on file",
        },
        records: [],
        followUp: null,
        confidenceNote: "A self-reported state with no saved training commitment attached.",
        refused: "Ashwini will not fabricate a session, recovery verdict, or training plan.",
        choices: [],
        target: null,
        expectedLag: null,
        gated: false,
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
  },
};

export const medicationRule: Rule = {
  id: "medication",
  matches: (context) =>
    attributedHealthClauses(context.text).some((clause) => {
      if (!isOwnerHealthClause(clause) || MEDICATION_NON_EVENT.test(clause.text)) return false;
      const clauseContext = { ...context, text: clause.text };
      return MEDICATION.test(clause.text) || mentionedMedications(clauseContext).length > 0;
    }),
  apply: (context) => ({
    domain: "medication",
    evidenceStatus: "recorded",
    ladderLevel: 0,
    decisionType: "recommendation",
    route: null,
    reply: {
      text: "Recorded your wording in the protected medication lane. This check-in is not yet matched to a scheduled dose, supply count, or refill record. Dose or timing questions still go to your prescriber or pharmacist.",
      kind: "record",
      receipt: "Protected medication record",
    },
    records: [{ kind: "medication_event", text: context.input.utterance.text }],
    followUp: null,
    confidenceNote: "An adherence record. No claim is made about effectiveness.",
    refused:
      "Ashwini will not evaluate whether the medication is working or treat it as an experimental variable.",
    choices: [],
    target: "A retained medication-context record",
    expectedLag: null,
    gated: false,
  }),
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
      text: "Recorded as context. I do not have enough structured information to make a recommendation from that wording, and I would rather say that than manufacture a reason to act. Start a new check-in with what changed or the decision you need help with if you want Ashwini to evaluate something specific. Do not rely on this app for immediate danger or new, severe, or worsening symptoms; contact emergency services or appropriate human care now.",
      kind: "record",
      receipt: "Context retained · no recommendation inferred",
    },
    records: [{ kind: "context_note", text: context.input.utterance.text }],
    followUp: null,
    confidenceNote: "Stored as a recorded fact. PRD 5 level 0: store, and normally stay silent.",
    refused: "Ashwini will not infer a conclusion from an unclassified note.",
    choices: [],
    target: null,
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
  medicationRule,
  nutritionRule,
  recoveryRule,
  fallbackRule,
];

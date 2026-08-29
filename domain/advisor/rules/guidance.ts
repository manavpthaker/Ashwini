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
import { containsWord } from "../rule";
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

const SUPPLEMENT_INTENT =
  /\b(supplement|stack|should i (take|add|start)|worth taking|thinking about taking)\b/;

const MSK =
  /\b(shoulder|knee|back|hip|elbow|wrist|ankle|neck|hamstring|quad|calf|groin|achilles|rotator cuff|lower back)\b|\b(pain|hurts?|hurting|sore|soreness|ache|aching|aches|injur\w*|strain\w*|sprain\w*|tweak\w*|pull(ed)? (a )?muscle|stiff)\b/;

const NUTRITION =
  /\b(ate|eaten|eating|had (lunch|dinner|breakfast|a snack)|lunch|dinner|breakfast|snack|meal|food|calories|kcal|protein|carbs|macros|dal|rice|sandwich|salad|yogurt|eggs?|chicken|shake)\b/;

const RECOVERY =
  /\b(flat|tired|exhausted|knackered|wiped|drained|low energy|no energy|sluggish|sleepy|fatigued?|didn'?t sleep|bad sleep|poor sleep|slept badly|rough night|run down|training|workout|session|gym|lift(ing)?|volume|deload|cardio|run)\b/;

const MEDICATION =
  /\b(took my|take my|taking my|missed my|forgot my|refill|pharmacy|adherence|medication|meds|pill|tablet|dose)\b/;

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
    mentionedSupplements(context).length > 0 || SUPPLEMENT_INTENT.test(context.text),
  apply: (context) => {
    const supplements = mentionedSupplements(context);
    const currentMedications = context.input.context.medications.map((m) => m.name);
    const subjects = [...supplements, ...currentMedications];

    const fresh = context.input.context.interactionResults.find((result) => {
      const notExpired = result.expiresAt === null || result.expiresAt > context.input.now;
      const covers = supplements.every((item) =>
        result.items.some((covered) => covered.toLowerCase() === item.toLowerCase()),
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
          text: `I can't answer that safely yet. A supplement recommendation needs a current interaction check against everything you're already taking, and I don't have one${supplements.length > 0 ? ` covering ${formatList(supplements, "these items")}` : ""}. I've queued the check — no result means no answer, not a quiet all-clear.`,
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
        choices: ["Run the interaction check", "Do nothing for now"],
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
      choices: ["Add it and track", "Hold off", "Do nothing"],
      target: null,
      expectedLag: null,
      gated: true,
    };
  },
};

export const musculoskeletalRule: Rule = {
  id: "symptom-msk",
  matches: ({ text }) => MSK.test(text),
  apply: (context) => ({
    domain: "training",
    evidenceStatus: "rule_based",
    ladderLevel: 2,
    decisionType: "recommendation",
    route: null,
    reply: {
      text: "I'd take the painful movement out of today's session rather than test it under load — that's the reversible choice and it costs you almost nothing. What decides the next step is whether this is new, getting worse, or limiting normal movement outside training. Tell me which and I'll either swap the session or prepare a physio handoff.",
      kind: "question",
      receipt: "Training adjustment · symptom follow-up needed",
    },
    records: [
      {
        kind: "symptom",
        text: context.input.utterance.text,
        bodyRegion: bodyRegionFrom(context.text),
      },
    ],
    followUp: "Is this new, getting worse, or limiting normal movement?",
    confidenceNote: "Based on your report alone. No assessment of the underlying cause was made.",
    refused:
      "Ashwini will not diagnose an injury, judge technique from text, or prescribe rehabilitation.",
    choices: ["Swap the session", "Keep it and avoid the movement", "Prepare a physio handoff"],
    target: "Train around it without losing the session",
    expectedLag: "Same day",
    gated: true,
  }),
};

export const nutritionRule: Rule = {
  id: "nutrition",
  matches: ({ text }) => NUTRITION.test(text),
  apply: (context) => ({
    domain: "nutrition",
    evidenceStatus: "recorded",
    ladderLevel: 0,
    decisionType: "recommendation",
    route: null,
    reply: {
      text: "Recorded. Without a recipe or a photo I'm holding this as a rough estimate rather than a number — it counts toward the weekly trend, not a hard daily target. If there was a clear protein source, tell me and I'll tighten the range; if not, that's worth knowing too.",
      kind: "record",
      receipt: "Nutrition record · estimate held as a range",
    },
    records: [{ kind: "meal", mealKind: mealKindFrom(context.text) }],
    followUp: "Was there a clear protein source in this one?",
    confidenceNote:
      "PRD 7.2: a meal estimate without recipe data is an educated range, useful for trends and not for a daily target.",
    refused:
      "Ashwini will not present a photo or text estimate as an exact calorie or protein figure.",
    choices: ["Add the detail", "Leave it as an estimate"],
    target: "A usable weekly nutrition trend",
    expectedLag: "Weekly",
    gated: true,
  }),
};

export const recoveryRule: Rule = {
  id: "training-volume",
  matches: ({ text }) => RECOVERY.test(text),
  apply: () => ({
    domain: "training",
    evidenceStatus: "rule_based",
    ladderLevel: 3,
    decisionType: "recommendation",
    route: null,
    reply: {
      text: "That changes the volume call rather than the session itself. I'd keep the session on the board and cap it at the reduced version unless energy clearly comes back — going in at full volume on a bad night is where the wasted week usually starts. I'll ask once before you train instead of making you decide now.",
      kind: "recommendation",
      receipt: "Training plan · reduced volume favoured",
    },
    records: [],
    followUp: null,
    confidenceNote:
      "A working synthesis from your reported state and the current plan, not a measured recovery finding.",
    refused:
      "Ashwini will not attribute this to a medical cause or claim a recovery effect it has not measured.",
    choices: ["Reduced volume", "Full session", "Swap to mobility", "Decide at the session"],
    target: "Keep training consistency without a wasted session",
    expectedLag: "Same day",
    gated: true,
  }),
};

export const medicationRule: Rule = {
  id: "medication",
  matches: ({ text }) => MEDICATION.test(text),
  apply: (context) => ({
    domain: "medication",
    evidenceStatus: "recorded",
    ladderLevel: 0,
    decisionType: "recommendation",
    route: null,
    reply: {
      text: "Recorded in the protected medication lane. I track adherence, supply, and refill risk here, and I keep it separate from anything I treat as an experiment. Dose or timing questions go to your prescriber, and I'll bring the record when they do.",
      kind: "record",
      receipt: "Protected medication record",
    },
    records: [{ kind: "medication_event", text: context.input.utterance.text }],
    followUp: null,
    confidenceNote: "An adherence record. No claim is made about effectiveness.",
    refused:
      "Ashwini will not evaluate whether the medication is working or treat it as an experimental variable.",
    choices: [],
    target: "An accurate adherence record",
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
      text: "Recorded as context. I don't think this changes anything on today's plan yet, and I'd rather say that than manufacture a reason to act. What would help most here — how you're feeling, what you did, or something you want me to help decide?",
      kind: "question",
      receipt: "Context retained · one follow-up",
    },
    records: [{ kind: "context_note", text: context.input.utterance.text }],
    followUp: "Is this something you want me to act on, or just keep?",
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

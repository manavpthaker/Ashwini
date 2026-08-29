/**
 * The terminal safety rules (PRD 4.4, 11).
 *
 * These sit at the top of the pipeline and stop it. Order within this file is
 * the order in the pipeline, and it is load-bearing: `skin-lesion` must precede
 * any musculoskeletal matcher, or "the mole on my back looks different" is
 * answered with training advice — which is what the prototype does today, and
 * is a direct PRD 11.4 violation.
 *
 * A keyword matcher is not triage. These lists are deliberately wide and fail
 * toward routing out. The golden tests, not the regexes, are the deliverable.
 */

import type { Rule, RuleOutcome } from "../rule";
import { mentionedMedications } from "../rule";
import { formatList } from "../../text";

const CRISIS =
  /\b(suicid\w*|kill myself|killing myself|end my life|ending my life|want to die|wanna die|don'?t want to (be here|live)|self.?harm|harm myself|hurt myself|cut myself|overdose on purpose|take all my pills)\b/;

const URGENT =
  /\b(chest (pain|pressure|tightness)|crushing (pain|pressure)|can'?t breathe|cannot breathe|can'?t catch my breath|struggling to breathe|trouble breathing|difficulty breathing|throat (is )?closing|tongue (is )?swelling|anaphyla\w*|face (is )?droop\w*|drooping face|slurr\w*|one.?sided weakness|weakness on one side|numb(ness)? (in|on|down) (my )?(left|right) (arm|side|leg)|worst headache|sudden severe headache|thunderclap|passed out|blacked out|fainted|seizure|convuls\w*|coughing (up )?blood|vomiting blood|blood in my (stool|vomit|urine)|bleeding (heavily|won'?t stop)|sudden vision loss|lost my vision|stiff neck and fever)\b/;

const PREGNANCY =
  /\b(pregnan\w*|conceiv\w*|ttc|trying for a baby|breastfeed\w*|nursing|postpartum|post.?partum)\b/;

/**
 * PRD 11.4: "Moles, lesions, and pigmented spots are never analyzed."
 * Rashes are included so that a skin complaint on a named body part cannot fall
 * through to the musculoskeletal rule.
 */
const SKIN =
  /\b(mole|moles|lesion|lesions|freckle\w*|pigment\w*|birthmark|skin tag|melanoma|rash|hives|discolou?r\w*|(dark|new|odd|weird|changing|strange) (spot|mark|patch)|spot on my (skin|back|arm|leg|face|chest|shoulder|neck))\b/;

/** Explicit "do these combine" language. */
const COMBINE =
  /\b(interact\w*|together|combine|combining|mix|mixing|alongside|at the same time|take both|both at once)\b/;

/**
 * A deliberative frame. This is what separates "can I take X with Y" (a
 * pharmacist question) from "took my X with breakfast" (an adherence log) —
 * without it, every logged dose would be routed out.
 */
const ASKING =
  /\b(can|could|should|would|is it|are they|ok to|okay to|safe to|fine to|any (issue|problem|risk|harm))\b/;

const PRESCRIPTION_CHANGE =
  /\b((increase|increasing|decrease|decreasing|raise|raising|lower|lowering|double|doubling|halve|halving|split|stop|stopping|skip|skipping|quit|change|changing|adjust|adjusting|switch|switching|taper|tapering|wean|weaning|come off|get off)\b[^.?!]{0,40}\b(dose|dosage|medication|meds|prescription|pill|tablet|mg)|\b(dose|dosage|medication|meds|prescription)\b[^.?!]{0,40}\b(increase|decrease|higher|lower|double|stop|skip|change|adjust|switch|taper))\b/;

const THERAPY =
  /\b(therapy|therapist|counsell?or|counselling|counseling|psychotherap\w*|my session with)\b/;

function reply(text: string, receipt: string): RuleOutcome["reply"] {
  return { text, kind: "route", receipt };
}

export const crisisRule: Rule = {
  id: "crisis",
  matches: ({ text }) => CRISIS.test(text),
  apply: () => ({
    domain: "system",
    evidenceStatus: "route_out",
    ladderLevel: 5,
    decisionType: "route_out",
    route: "crisis_line",
    reply: reply(
      "I'm not the right support for this, and I don't want to leave you with a health app when you need a person. Please contact a crisis line now — in the US and Canada you can call or text 988; the UK is 111, and 112 works across the EU. If you are in immediate danger, call emergency services. I've kept nothing about this beyond the fact that you reached out.",
      "Crisis route · no interpretation, no analysis",
    ),
    records: [{ kind: "context_note", text: "Crisis route-out issued." }],
    followUp: null,
    confidenceNote:
      "Routed on the user's own words. Ashwini does not assess mental-health risk and makes no judgement about severity.",
    refused: "Ashwini will not interpret, triage, or advise on this.",
    choices: [],
    target: null,
    expectedLag: null,
    gated: false,
  }),
};

export const urgentSymptomRule: Rule = {
  id: "urgent-symptoms",
  matches: ({ text }) => URGENT.test(text),
  apply: ({ input }) => ({
    domain: "system",
    evidenceStatus: "route_out",
    ladderLevel: 5,
    decisionType: "route_out",
    route: "emergency",
    reply: reply(
      "This is not a wait-and-see item. Stop what you're doing and seek urgent medical help now — emergency services, or urgent care if you can get there faster. I've kept your exact wording and the time so you can show what you reported rather than reconstructing it.",
      "Urgent route · original wording retained",
    ),
    records: [
      { kind: "symptom", text: input.utterance.text, bodyRegion: null },
      { kind: "context_note", text: "Urgent route-out issued." },
    ],
    followUp: null,
    confidenceNote:
      "Routed on reported symptoms alone. Ashwini has not assessed severity and cannot rule anything in or out.",
    refused:
      "Ashwini will not estimate how serious this is, suggest it can wait, or offer a non-clinical explanation.",
    choices: [],
    target: null,
    expectedLag: null,
    gated: false,
  }),
};

export const pregnancyRule: Rule = {
  id: "pregnancy",
  matches: ({ text }) => PREGNANCY.test(text),
  apply: ({ input }) => ({
    domain: "system",
    evidenceStatus: "route_out",
    ladderLevel: 5,
    decisionType: "route_out",
    route: "clinician",
    reply: reply(
      "I've recorded this, but it changes the risk profile for nutrition, supplements, and training all at once, and those calls need a clinician who can evaluate you. I'll keep the record and prepare a handoff; I won't be adjusting your plan off my own reasoning while this is open.",
      "Protected record · clinician handoff prepared",
    ),
    records: [{ kind: "context_note", text: input.utterance.text }],
    followUp: null,
    confidenceNote:
      "PRD 4.4 places pregnancy outside the low-risk, reversible domains Ashwini may recommend within.",
    refused:
      "Ashwini will not give nutrition, supplement, or training recommendations under this condition.",
    choices: [],
    target: null,
    expectedLag: null,
    gated: false,
  }),
};

export const skinLesionRule: Rule = {
  id: "skin-lesion",
  matches: ({ text }) => SKIN.test(text),
  apply: ({ input }) => ({
    domain: "body",
    evidenceStatus: "route_out",
    ladderLevel: 5,
    decisionType: "route_out",
    route: "dermatologist",
    // Deliberately says nothing about what it might be, how it looks, or whether
    // it is concerning. PRD 11.4 excludes this from analysis entirely.
    reply: reply(
      "I don't analyse skin marks, and I'm not going to guess at this one — that belongs with a dermatologist. What I can do is document it properly: a dated photo in consistent light, with something for scale, so they see change over time rather than one snapshot. Want me to set up that capture and prepare the handoff?",
      "Documented for dermatology · not analysed",
    ),
    records: [{ kind: "dermatology_handoff", userWording: input.utterance.text }],
    followUp: "Should I start a dated capture series for this so the change is visible later?",
    confidenceNote:
      "No assessment was made. PRD 11.4 excludes moles, lesions, and pigmented spots from analysis.",
    refused: "Ashwini will not describe, assess, or estimate the significance of any skin mark.",
    choices: ["Start a capture series", "Just record it", "Do nothing for now"],
    target: null,
    expectedLag: null,
    gated: false,
  }),
};

export const drugDrugRule: Rule = {
  id: "drug-drug",
  matches: (context) => {
    const named = mentionedMedications(context);
    if (named.length === 0) return false;
    // Two of the user's own medications in one sentence is a combination question
    // whatever the phrasing.
    if (named.length >= 2) return true;
    if (COMBINE.test(context.text)) return true;
    return ASKING.test(context.text) && /\bwith\b/.test(context.text);
  },
  apply: (context) => {
    const named = mentionedMedications(context);
    return {
      domain: "medication",
      evidenceStatus: "route_out",
      ladderLevel: 5,
      decisionType: "route_out",
      route: "pharmacist",
      reply: reply(
        `This is a drug–drug question about ${formatList(named, "your medications")}, and it goes to your pharmacist. My only licensed interaction source is Examine Connect, which covers supplement–drug and supplement–supplement safety and explicitly does not cover drug–drug. A pharmacist can check this against your full list in minutes and it's free. I've recorded the question so you don't have to retype it.`,
        "Pharmacist handoff · outside Examine coverage",
      ),
      records: [{ kind: "medication_event", text: context.input.utterance.text }],
      followUp: null,
      confidenceNote:
        "No interaction source was consulted. PRD 7.3 forbids inferring safety from silence.",
      refused: "Ashwini will not perform or approximate a drug–drug interaction check.",
      choices: ["Prepare a pharmacist handoff", "Just record the question"],
      target: null,
      expectedLag: null,
      gated: false,
    };
  },
};

export const prescriptionChangeRule: Rule = {
  id: "prescription-change",
  matches: ({ text }) => PRESCRIPTION_CHANGE.test(text),
  apply: ({ input }) => ({
    domain: "medication",
    evidenceStatus: "route_out",
    ladderLevel: 5,
    decisionType: "route_out",
    route: "prescriber",
    reply: reply(
      "Dose and timing changes are your prescriber's call, not mine — and a prescription is never something I'll treat as an experiment. What I can do is bring the evidence: I have your adherence record and the timeline, which is usually the part that's hard to reconstruct in an appointment. Want me to prepare that handoff?",
      "Prescriber handoff · adherence record attached",
    ),
    records: [{ kind: "medication_event", text: input.utterance.text }],
    followUp: "Should I prepare the adherence summary for your prescriber?",
    confidenceNote:
      "PRD 11.6 and 7.3: prescription medication is never an experimental variable and dose changes are prescriber-controlled.",
    refused:
      "Ashwini will not suggest a dose, timing, or treatment change, or evaluate whether a prescription is working.",
    choices: ["Prepare the handoff", "Just record it"],
    target: null,
    expectedLag: null,
    gated: false,
  }),
};

export const therapyRule: Rule = {
  id: "therapy-content",
  matches: ({ text }) => THERAPY.test(text),
  apply: () => ({
    domain: "focus",
    evidenceStatus: "recorded",
    ladderLevel: 0,
    decisionType: "recommendation",
    route: null,
    reply: {
      text: "I've noted that you had a session, and nothing else. Therapy content stays outside everything I reason from — I don't store it and I don't let it influence a recommendation. If something practical came out of it that you want tracked, tell me that part directly and I'll record it on its own.",
      kind: "record",
      receipt: "Session noted · content not stored, excluded from inference",
    },
    // PRD 11.9: the fact is recorded; the text is deliberately not persisted.
    records: [{ kind: "therapy_mention" }],
    followUp: null,
    confidenceNote: "PRD 11.9: therapy content is inert and excluded from inference.",
    refused: "Ashwini will not store therapy content or use it as an inference source.",
    choices: [],
    target: null,
    expectedLag: null,
    gated: false,
  }),
};

/** In pipeline order. Do not reorder without reading tests/domain/advisor/order.test.ts. */
export const safetyRules: readonly Rule[] = [
  crisisRule,
  urgentSymptomRule,
  pregnancyRule,
  skinLesionRule,
  drugDrugRule,
  prescriptionChangeRule,
  therapyRule,
];

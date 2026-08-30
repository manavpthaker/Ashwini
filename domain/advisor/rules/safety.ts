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
import { attributedHealthClauses, isOwnerHealthClause, mentionedMedications } from "../rule";
import { classifySensitiveContent } from "../sensitive-content";
import { formatList } from "../../text";

const URGENT =
  /\b(chest (pain|pressure|tightness)|my chest hurts?|crushing (pain|pressure)|shortness of breath|can'?t breathe|cannot breathe|can'?t catch my breath|cannot get enough air|can'?t get enough air|struggling to breathe|trouble breathing|difficulty breathing|(?:i feel like i am|i feel like i'm|i am|i'm) choking|(?:having|i am having|i'm having) (?:a )?(?:heart attack|stroke)|throat (is )?closing|tongue (is )?swelling|anaphyla\w*|face (is )?droop\w*|drooping face|slurr\w*|one.?sided weakness|weakness on one side|numb(ness)? (in|on|down) (my )?(left|right) (arm|side|leg)|worst headache|sudden severe headache|thunderclap|passed out|blacked out|fainted|seizure|convuls\w*|coughing (up )?blood|vomiting blood|blood in my (stool|vomit|urine)|bleeding (heavily|won'?t stop)|sudden vision loss|lost my vision|(?:took|swallowed|ingested) (?:a (?:whole )?bottle|a handful|\d{2,}) (?:of )?(?:pills|tablets|capsules|meds|medication|tylenol|acetaminophen|paracetamol|ibuprofen|advil|motrin))\b/;

const OVERDOSE =
  /\boverdosed?(?: on\b[^.?!]{0,40})?\b|\b(?:took|taken|swallowed|ingested)\b[^.?!]{0,35}\b(?:(?:all|too many|too much|a lot|a handful|a bunch)(?: of)? (?:my )?|(?:a|the) (?:whole )?bottle(?: of )?|(?:\d{2,}|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)(?: of )?(?:my )?)\s*(?:pills|tablets|capsules|meds|medication|tylenol|acetaminophen|paracetamol|ibuprofen|advil|motrin)\b|\b(?:took|taken)\b[^.?!]{0,35}\b(?:more (?:pills|tablets|capsules|meds|medication) than (?:i|we) should(?: have)?|an? (?:accidental )?(?:double|extra) dose|(?:my )?(?:pills|tablets|capsules|meds|medication) twice)\b/;

const UNILATERAL_WEAKNESS =
  /\b(?:my )?(?:left|right) (?:arm|leg|side) (?:(?:is|feels?) )?(?:suddenly )?weak\b|\b(?:sudden(?:ly)? )?weakness (?:in|on|down) (?:my )?(?:left|right) (?:arm|leg|side)\b/;
const UNILATERAL_WEAKNESS_NEGATED =
  /\b(?:my )?(?:left|right) (?:arm|leg|side) (?:(?:is|feels?) )?(?:not|no longer) weak\b|\b(?:no|without|deny|denies|denied) (?:any )?(?:sudden )?weakness (?:in|on|down) (?:my )?(?:left|right) (?:arm|leg|side)\b/;

const HIGH_MULTI_PILL_INGESTION =
  /\b(?:took|have taken|swallowed|ingested)\b[^.?!]{0,35}\b(?:[6-9]|\d{2,}|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s*(?:of )?(?:my )?(?:sleeping )?(?:pills?|tablets?|capsules?|doses?|meds?|medications?|tylenol|acetaminophen|paracetamol|ibuprofen|advil|motrin)\b/;
const EXTRA_MULTI_PILL_INGESTION =
  /\b(?:took|have taken|swallowed|ingested)\b[^.?!]{0,35}\b(?:(?:[2-9]|\d{2,}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:extra|additional)|(?:extra|additional)\s+(?:[2-9]|\d{2,}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve))\s+(?:pills?|tablets?|capsules?|doses?|meds?|medications?)\b/;
const ACCIDENTAL_MULTI_PILL_INGESTION =
  /\b(?:accidentally|by mistake)\s+(?:took|have taken|swallowed|ingested)\b[^.?!]{0,35}\b(?:[2-9]|\d{2,}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:pills?|tablets?|capsules?|doses?|meds?|medications?)\b|\b(?:took|have taken|swallowed|ingested)\b[^.?!]{0,35}\b(?:[2-9]|\d{2,}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:pills?|tablets?|capsules?|doses?|meds?|medications?)\b[^.?!]{0,20}\b(?:accidentally|by mistake)\b/;

const STIFF_NECK = /\b(stiff neck|neck (?:is|feels?) stiff)\b/;
const FEVER = /\bfever(?:ish)?\b/;
const URGENT_NEGATED =
  /\b(?:do not|don't|did not|didn't|does not|doesn't|have not|haven't|am not|i'm not|no longer|never)\s+(?:currently )?(?:have|having|feel|feeling|experience|experiencing|had)?\s*(?:any |a )?(?:chest pain|chest pressure|shortness of breath|trouble breathing|difficulty breathing|heart attack|stroke|seizure|fainting|fever|stiff neck)\b|\b(?:have not|haven't) (?:passed out|fainted)\b|\b(?:no|deny|denies|denied) (?:any )?(?:chest pain|chest pressure|shortness of breath|trouble breathing|difficulty breathing|heart attack|stroke|seizure|fever|stiff neck)\b|\b(?:i )?(?:have |had )?never had (?:a )?(?:seizure|fainting episode)\b|\b(?:did not|didn't|have not|haven't) (?:overdose|overdosed|take|swallow|swallowed|ingest|ingested)\b|\bi(?:'m| am) not (?:going|planning|about) to overdose\b|\bi (?:do not|don't) plan to overdose\b/;
const URGENT_HYPOTHETICAL =
  /\b(?:if|what if|in case)\b[^.?!]{0,100}\b(?:chest pain|chest pressure|shortness of breath|trouble breathing|difficulty breathing|seizure|faint|fever|stiff neck|overdose|(?:left|right) (?:arm|leg|side)[^.?!]{0,20}weak|weakness (?:in|on|down) (?:my )?(?:left|right) (?:arm|leg|side)|(?:took|take|swallowed|ingested)[^.?!]{0,35}(?:pills?|tablets?|capsules?|doses?|tylenol|acetaminophen|paracetamol|ibuprofen|advil|motrin))\b/;
const URGENT_HISTORICAL =
  /\b(?:used to have|previously had)\b[^.?!]{0,50}\b(?:chest pain|chest pressure|shortness of breath|trouble breathing|difficulty breathing|seizure|fever|stiff neck|weakness)\b|\b(?:had (?:chest pain|chest pressure|a seizure|fever|a stiff neck)|fainted|passed out|(?:my )?(?:left|right) (?:arm|leg|side) (?:was|felt) (?:suddenly )?weak)\b[^.?!]{0,45}\b(?:yesterday|last (?:week|month|year)|(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten) (?:days?|weeks?|months?|years?) ago|as a child)\b/;

const MSK_COMPLAINT =
  /\b(?:pain(?:ful)?|hurts?|hurting|injur\w*|sprain\w*|strain\w*|swollen|swelling|stiff(?:ness)?)\b/;
const MSK_LOSS_OF_FUNCTION =
  /\b(?:cannot|can't|unable to|can barely)\s+(?:lift|move|use|raise|straighten|bend|walk|stand|put weight on|bear weight on)\b/;
const MSK_BODY_REGION = /\b(?:arm|shoulder|hand|wrist|elbow|leg|knee|ankle|foot|hip|back|neck)\b/;
const MSK_NEUROLOGICAL =
  /\b(?:numb(?:ness)?|tingl\w*|pins and needles|loss of sensation|new weakness|weak grip)\b/;
const MSK_NEUROLOGICAL_NEGATED =
  /\b(?:no|not|without|do not|don't|did not|didn't)\b[^.?!]{0,24}\b(?:numb(?:ness)?|tingl\w*|pins and needles|loss of sensation|weakness|weak grip)\b/;
const MSK_TRAUMA =
  /\b(?:after|when) (?:i |we )?(?:fell|fall|crashed|collided|was hit|landed hard)\b|\b(?:i|we) (?:fell|crashed|collided|landed hard)\b|\b(?:after|from) (?:a |the )?(?:fall|crash|collision|hard impact)\b|\bheard (?:a )?pop\b|\bvisible deformity\b/;
const MSK_EXPLICIT_IMPACT =
  /\b(?:landed hard|hard impact|heard (?:a )?pop(?!\s+music)|visible deformity)\b/;
const MSK_SEVERE_OR_WORSENING =
  /\b(?:severe|unbearable|rapidly worsening|getting worse|worsening)\b[^.?!]{0,30}\b(?:pain|injury|swelling)\b|\b(?:pain|injury|swelling)\b[^.?!]{0,30}\b(?:severe|unbearable|rapidly worsening|getting worse|worsening)\b/;
const MSK_RED_FLAG_HYPOTHETICAL =
  /\b(?:if|what if|in case)\b[^.?!]{0,100}\b(?:pain|hurt|injury|numb|tingl|weak|fall|fell|cannot|can't|unable|pop|crash|collision)\b/;
const MSK_RED_FLAG_HISTORICAL =
  /\b(?:used to have|previously had)\b[^.?!]{0,80}\b(?:pain|injury|numb|tingl|weakness|stiffness)\b|\b(?:fell|had (?:a )?(?:fall|crash|collision)|heard (?:a )?pop|(?:arm|hand|leg|foot) (?:was|felt) (?:numb|tingling|weak))\b[^.?!]{0,45}\b(?:yesterday|last (?:week|month|year)|(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten) (?:days?|weeks?|months?|years?) ago|in the past)\b/;

function isCurrentOwnerMskRedFlag(text: string): boolean {
  const ownerText = attributedHealthClauses(text)
    .filter(isOwnerHealthClause)
    .map((clause) => clause.text)
    .join(" ");

  const lossOfFunction = MSK_LOSS_OF_FUNCTION.test(ownerText) && MSK_BODY_REGION.test(ownerText);
  const neurological =
    MSK_NEUROLOGICAL.test(ownerText) &&
    (MSK_BODY_REGION.test(ownerText) || /\bweak grip\b/.test(ownerText)) &&
    !MSK_NEUROLOGICAL_NEGATED.test(ownerText);
  const trauma =
    MSK_TRAUMA.test(ownerText) &&
    (MSK_BODY_REGION.test(ownerText) ||
      MSK_COMPLAINT.test(ownerText) ||
      MSK_EXPLICIT_IMPACT.test(ownerText));
  const severeOrWorsening = MSK_SEVERE_OR_WORSENING.test(ownerText);

  if (
    (!MSK_COMPLAINT.test(ownerText) &&
      !lossOfFunction &&
      !neurological &&
      !trauma &&
      !severeOrWorsening) ||
    MSK_RED_FLAG_HYPOTHETICAL.test(ownerText) ||
    MSK_RED_FLAG_HISTORICAL.test(ownerText)
  ) {
    return false;
  }

  return lossOfFunction || neurological || trauma || severeOrWorsening;
}

function isOwnerMskRedFlagHypothetical(text: string): boolean {
  const ownerText = attributedHealthClauses(text)
    .filter(isOwnerHealthClause)
    .map((clause) => clause.text)
    .join(" ");
  const lossOfFunction = MSK_LOSS_OF_FUNCTION.test(ownerText) && MSK_BODY_REGION.test(ownerText);
  const neurological =
    MSK_NEUROLOGICAL.test(ownerText) &&
    (MSK_BODY_REGION.test(ownerText) || /\bweak grip\b/.test(ownerText)) &&
    !MSK_NEUROLOGICAL_NEGATED.test(ownerText);
  const trauma =
    MSK_TRAUMA.test(ownerText) &&
    (MSK_BODY_REGION.test(ownerText) ||
      MSK_COMPLAINT.test(ownerText) ||
      MSK_EXPLICIT_IMPACT.test(ownerText));

  return MSK_RED_FLAG_HYPOTHETICAL.test(ownerText) && (lossOfFunction || neurological || trauma);
}

function isCurrentPersonalUrgentText(text: string): boolean {
  const hasFeverWithStiffNeck = STIFF_NECK.test(text) && FEVER.test(text);
  if (
    hasFeverWithStiffNeck &&
    !URGENT_NEGATED.test(text) &&
    !URGENT_HYPOTHETICAL.test(text) &&
    !URGENT_HISTORICAL.test(text) &&
    attributedHealthClauses(text).some(
      (clause) => STIFF_NECK.test(clause.text) || FEVER.test(clause.text),
    )
  ) {
    return true;
  }

  return attributedHealthClauses(text).some((clause) => {
    const hasUrgentSignal =
      URGENT.test(clause.text) ||
      OVERDOSE.test(clause.text) ||
      UNILATERAL_WEAKNESS.test(clause.text) ||
      HIGH_MULTI_PILL_INGESTION.test(clause.text) ||
      EXTRA_MULTI_PILL_INGESTION.test(clause.text) ||
      ACCIDENTAL_MULTI_PILL_INGESTION.test(clause.text) ||
      (STIFF_NECK.test(clause.text) && FEVER.test(clause.text));
    if (
      !hasUrgentSignal ||
      URGENT_NEGATED.test(clause.text) ||
      UNILATERAL_WEAKNESS_NEGATED.test(clause.text) ||
      URGENT_HYPOTHETICAL.test(clause.text) ||
      URGENT_HISTORICAL.test(clause.text)
    ) {
      return false;
    }
    return true;
  });
}

const PREGNANCY =
  /\b(pregnan\w*|conceiv\w*|ttc|trying for a baby|breastfeed\w*|nursing|postpartum|post.?partum)\b/;
const PREGNANCY_NEGATED =
  /\b(?:(?:i am|i'm|we are|we're) (?:not|no longer)|not|never|no longer) (?:currently )?(?:pregnant|breastfeeding|nursing|postpartum)\b/;
const PREGNANCY_HYPOTHETICAL =
  /\b(?:if|what if|in case)\b[^.?!]{0,80}\b(?:pregnan\w*|conceiv\w*|breastfeed\w*|postpartum)\b/;
const PREGNANCY_HISTORICAL =
  /\b(?:was|were|used to be)\b[^.?!]{0,30}\b(?:pregnan\w*|breastfeed\w*|nursing|postpartum)\b[^.?!]{0,30}\b(?:last (?:year|month)|(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten) (?:months?|years?) ago|previously|in the past)\b/;

/**
 * PRD 11.4: "Moles, lesions, and pigmented spots are never analyzed."
 * Rashes are included so that a skin complaint on a named body part cannot fall
 * through to the musculoskeletal rule.
 */
const SKIN =
  /\b(mole|moles|lesion|lesions|freckle\w*|pigment\w*|birthmark|skin tag|melanoma|rash|hives|discolou?r\w*|(dark|new|odd|weird|changing|strange) (spot|mark|patch)|spot on my (skin|back|arm|leg|face|chest|shoulder|neck))\b/;
const SKIN_NEGATED =
  /\b(?:do not|don't|did not|didn't|have not|haven't|no longer|never)\b[^.?!]{0,40}\b(?:mole|lesion|rash|hives|spot|mark|patch|skin tag)\b/;
const SKIN_HYPOTHETICAL =
  /\b(?:if|what if|in case) (?:i|we) (?:ever )?(?:get|develop|have|had|notice)\b[^.?!]{0,60}\b(?:mole|lesion|rash|hives|spot|mark|patch|skin tag)\b/;
const SKIN_HISTORICAL =
  /\b(?:used to have|previously had)\b[^.?!]{0,50}\b(?:mole|lesion|rash|hives|spot|mark|patch|skin tag)\b|\b(?:had|noticed)\b[^.?!]{0,50}\b(?:mole|lesion|rash|hives|spot|mark|patch|skin tag)\b[^.?!]{0,35}\b(?:last (?:week|month|year)|(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten) (?:days?|weeks?|months?|years?) ago|in the past)\b/;

/** Explicit "do these combine" language. */
const COMBINE =
  /\b(interact\w*|together|combine|combining|mix|mixing|alongside|at the same time|take both|both at once)\b/;

/**
 * Something medicinal is being asked about, whether or not Ashwini has it on
 * file.
 *
 * The drug–drug rule used to require a name from the user's own medication list,
 * which meant "can I take lisinopril with ibuprofen" fell through to the
 * fallback for anyone who had not entered their medications yet — the exact
 * question PRD 11.7 exists to route, failing open at the moment a new user is
 * most likely to ask it.
 *
 * Three signals, all deliberately conservative:
 *  - generic vocabulary ("meds", "pill", "prescription");
 *  - the over-the-counter names people actually type;
 *  - INN stems, the suffixes the naming system reserves for drug classes
 *    (-pril for ACE inhibitors, -statin, -sartan, and so on). These are close to
 *    unpronounceable as ordinary English, so matching on them over-routes far
 *    less than missing a real interaction question would cost.
 */
const MEDICATION_WORD =
  /\b(medication|medications|medicine|medicines|meds?|pill|pills|tablet|tablets|capsule|capsules|prescription|prescriptions|antibiotic\w*|painkiller\w*|nsaid|ibuprofen|advil|motrin|nurofen|tylenol|paracetamol|acetaminophen|aspirin|naproxen|aleve|antihistamine\w*|benadryl|zyrtec|claritin|melatonin|\w*(pril|sartan|olol|statin|azole|cillin|mycin|oxetine|azepam|zolam|tidine|parin|gliptin|glutide|tinib|formin|prazole))\b/;

/**
 * A deliberative frame. This is what separates "can I take X with Y" (a
 * pharmacist question) from "took my X with breakfast" (an adherence log) —
 * without it, every logged dose would be routed out.
 */
const ASKING =
  /\b(can|could|should|would|is it|are they|ok to|okay to|safe to|fine to|any (issue|problem|risk|harm))\b/;

const PRESCRIPTION_CHANGE =
  /\b((increase|increasing|decrease|decreasing|raise|raising|lower|lowering|double|doubling|halve|halving|split|stop|stopping|skip|skipping|quit|change|changing|adjust|adjusting|switch|switching|taper|tapering|wean|weaning|come off|get off)\b[^.?!]{0,40}\b(dose|dosage|medication|meds|prescription|pill|tablet|mg)|\b(dose|dosage|medication|meds|prescription)\b[^.?!]{0,40}\b(increase|decrease|higher|lower|double|stop|skip|change|adjust|switch|taper))\b/;
const PRESCRIPTION_CHANGE_NEGATED =
  /\b(?:do not|don't|did not|didn't|have not|haven't|am not|i'm not|never)\b[^.?!]{0,50}\b(?:increase|decrease|raise|lower|double|halve|split|stop|skip|change|adjust|switch|taper|wean)\w*\b/;
const PRESCRIPTION_ADVICE_QUESTION =
  /\b(?:should|can|could|would|may|do) (?:i|we) (?:take|use)\b|\bis it (?:ok|okay|safe|fine) (?:for (?:me|us) )?to (?:take|use)\b/;
const PRESCRIPTION_DOSE_OR_TIMING_TARGET =
  /\b(?:extra|additional|another|double|half) (?:dose|pill|tablet|capsule)\b|\b(?:[2-9]|\d{2,}|two|three|four|five|six|seven|eight|nine|ten) (?:pills?|tablets?|capsules?|doses?)\b|\b\d+(?:\.\d+)?\s*mg\b|\b(?:missed|forgot)\b[^.?!]{0,40}\b(?:dose|pill|tablet|capsule|medication|medicine|meds?)\b|\b(?:now|tonight|this morning|this afternoon|this evening|later)\b/;
const IMPLICIT_MEDICATION_TIMING_QUESTION =
  /\b(?:should|can|could|would|may|do) (?:i|we) take it (?:now|tonight|this morning|this afternoon|this evening|later)(?:\s+(?:or|instead of)\s+(?:now|tonight|this morning|this afternoon|this evening|later))?\b/;
const TRAINING_CHANGE_TARGET =
  /\b(?:skip|cancel|modify|change|reduce|shorten|adjust)\s+(?:training|the gym|my workout|my session|the workout|the session)\b/g;

function reply(text: string, receipt: string): RuleOutcome["reply"] {
  return { text, kind: "route", receipt };
}

export const crisisRule: Rule = {
  id: "crisis",
  matches: ({ text }) => classifySensitiveContent(text) === "crisis",
  apply: () => ({
    domain: "system",
    evidenceStatus: "route_out",
    ladderLevel: 5,
    decisionType: "route_out",
    route: "crisis_line",
    reply: reply(
      "I'm not the right support for this, and a health app should not be the only support here. If this is about you or someone else, contact a crisis service now — in the US or Canada, call or text 988; elsewhere, use the relevant country's official crisis service. If anyone may act on this now or cannot stay safe, call the local emergency number or go to the nearest emergency department now. I retained no wording—only the fact and time that this crisis route was shown.",
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
  matches: ({ text }) => isCurrentPersonalUrgentText(text),
  apply: () => ({
    domain: "system",
    evidenceStatus: "route_out",
    ladderLevel: 5,
    decisionType: "route_out",
    route: "emergency",
    reply: reply(
      "This is not a wait-and-see item. If this is about you or someone else, seek emergency medical help now—call emergency services or go to an emergency department. I've recorded that the emergency route was shown and when; I have not converted this wording into a clinical finding.",
      "Urgent route shown · time recorded, no clinical finding",
    ),
    records: [{ kind: "context_note", text: "Urgent route-out issued." }],
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

export const musculoskeletalRedFlagRule: Rule = {
  id: "musculoskeletal-red-flag",
  matches: ({ text }) => isCurrentOwnerMskRedFlag(text) || isOwnerMskRedFlagHypothetical(text),
  apply: ({ input, text }) => {
    if (isOwnerMskRedFlagHypothetical(text)) {
      return {
        domain: "body",
        evidenceStatus: "unusable",
        ladderLevel: 1,
        decisionType: "data_quality_block",
        route: null,
        reply: {
          text: "That is phrased as a hypothetical, so I have not recorded it as your symptom or routed it as a current concern. If this is happening now, say that directly; otherwise there is nothing to add to your health record.",
          kind: "question",
          receipt: "No current symptom recorded · no route created",
        },
        records: [],
        followUp: null,
        confidenceNote: "No current owner symptom was asserted.",
        refused:
          "Ashwini will not convert a hypothetical symptom into a personal health record or current clinical route.",
        choices: [],
        target: null,
        expectedLag: null,
        gated: false,
        gateOverride: {
          outcome: "blocked",
          reason: "The wording is hypothetical rather than a current symptom report.",
          checked: [],
        },
      };
    }

    return {
      domain: "body",
      evidenceStatus: "route_out",
      ladderLevel: 5,
      decisionType: "route_out",
      route: "clinician",
      reply: reply(
        "The loss of function, trauma, numbness or weakness, or severe/worsening symptom you reported is outside a training adjustment. Stop loading the affected movement and arrange prompt clinical assessment. If it is rapidly worsening or you develop emergency symptoms, use urgent or emergency care. Ashwini has recorded your report but has not assessed the cause.",
        "Clinician route recorded · training advice withheld",
      ),
      records: [{ kind: "symptom", text: input.utterance.text, bodyRegion: null }],
      followUp: null,
      confidenceNote:
        "Routed from the user's reported musculoskeletal red flag; no diagnosis or severity assessment was made.",
      refused:
        "Ashwini will not reduce a reported red flag to exercise selection, diagnose the injury, or prescribe rehabilitation.",
      choices: [],
      target: null,
      expectedLag: null,
      gated: false,
    };
  },
};

export const pregnancyRule: Rule = {
  id: "pregnancy",
  matches: ({ text }) =>
    attributedHealthClauses(text).some(
      (clause) =>
        PREGNANCY.test(clause.text) &&
        !PREGNANCY_NEGATED.test(clause.text) &&
        !PREGNANCY_HYPOTHETICAL.test(clause.text) &&
        !PREGNANCY_HISTORICAL.test(clause.text) &&
        isOwnerHealthClause(clause),
    ),
  apply: ({ input }) => ({
    domain: "system",
    evidenceStatus: "route_out",
    ladderLevel: 5,
    decisionType: "route_out",
    route: "clinician",
    reply: reply(
      "I've recorded the route and time, but this changes the risk profile for nutrition, supplements, and training all at once, and those calls need a clinician who can evaluate you. Handoff preparation is not connected yet, so contact that clinician directly and describe what changed; I won't adjust your plan from my own reasoning while this is open.",
      "Protected record · clinician route recorded",
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
  matches: ({ text }) =>
    attributedHealthClauses(text).some(
      (clause) =>
        SKIN.test(clause.text) &&
        !SKIN_NEGATED.test(clause.text) &&
        !SKIN_HYPOTHETICAL.test(clause.text) &&
        !SKIN_HISTORICAL.test(clause.text) &&
        isOwnerHealthClause(clause),
    ),
  apply: ({ input }) => ({
    domain: "body",
    evidenceStatus: "route_out",
    ladderLevel: 5,
    decisionType: "route_out",
    route: "dermatologist",
    // Deliberately says nothing about what it might be, how it looks, or whether
    // it is concerning. PRD 11.4 excludes this from analysis entirely.
    reply: reply(
      "I don't analyse skin marks, and I'm not going to guess at this one — that belongs with a dermatologist. I recorded the route and time. Photo capture and handoff preparation are not connected yet; arrange the review directly, describe what changed, and use your device if you want a dated photo for that clinician.",
      "Dermatology route recorded · not analysed",
    ),
    records: [{ kind: "dermatology_handoff", userWording: input.utterance.text }],
    followUp: null,
    confidenceNote:
      "No assessment was made. PRD 11.4 excludes moles, lesions, and pigmented spots from analysis.",
    refused: "Ashwini will not describe, assess, or estimate the significance of any skin mark.",
    choices: [],
    target: null,
    expectedLag: null,
    gated: false,
  }),
};

export const drugDrugRule: Rule = {
  id: "drug-drug",
  matches: (context) =>
    attributedHealthClauses(context.text).some((clause) => {
      if (!isOwnerHealthClause(clause)) return false;
      const clauseContext = { ...context, text: clause.text };
      const named = mentionedMedications(clauseContext);
      // Two of the user's own medications in one clause is a combination
      // question whatever the phrasing.
      if (named.length >= 2) return true;

      // Otherwise something medicinal has to be in play — on file or not —
      // before an interaction frame means anything.
      if (named.length === 0 && !MEDICATION_WORD.test(clause.text)) return false;

      if (COMBINE.test(clause.text)) return true;
      return ASKING.test(clause.text) && /\bwith\b/.test(clause.text);
    }),
  apply: (context) => {
    const named = mentionedMedications(context);
    return {
      domain: "medication",
      evidenceStatus: "route_out",
      ladderLevel: 5,
      decisionType: "route_out",
      route: "pharmacist",
      reply: reply(
        `This is a drug–drug question about ${formatList(named, "your medications")}, and it goes to your pharmacist. My only licensed interaction source is Examine Connect, which covers supplement–drug and supplement–supplement safety and explicitly does not cover drug–drug. I recorded the route and time, but no handoff is sent from this app; contact a pharmacist directly and describe the question.`,
        "Pharmacist route recorded · outside Examine coverage",
      ),
      records: [{ kind: "context_note", text: "Pharmacist route-out issued." }],
      followUp: null,
      confidenceNote:
        "No interaction source was consulted. PRD 7.3 forbids inferring safety from silence.",
      refused: "Ashwini will not perform or approximate a drug–drug interaction check.",
      choices: [],
      target: null,
      expectedLag: null,
      gated: false,
    };
  },
};

export const prescriptionChangeRule: Rule = {
  id: "prescription-change",
  matches: (context) => {
    const ownerText = attributedHealthClauses(context.text)
      .filter(isOwnerHealthClause)
      .map((clause) => clause.text)
      .join(", ");
    const medicationText = ownerText.replace(TRAINING_CHANGE_TARGET, "");
    const namedMedication = mentionedMedications({ ...context, text: medicationText }).length > 0;
    const hasMedicationSubject =
      namedMedication ||
      MEDICATION_WORD.test(medicationText) ||
      /\b(?:dose|doses|dosage)\b/.test(medicationText) ||
      /\b\d+(?:\.\d+)?\s*mg\b/.test(medicationText);
    const doseOrTimingQuestion =
      (PRESCRIPTION_ADVICE_QUESTION.test(medicationText) &&
        PRESCRIPTION_DOSE_OR_TIMING_TARGET.test(medicationText) &&
        hasMedicationSubject) ||
      IMPLICIT_MEDICATION_TIMING_QUESTION.test(medicationText);

    return (
      (PRESCRIPTION_CHANGE.test(medicationText) || doseOrTimingQuestion) &&
      !PRESCRIPTION_CHANGE_NEGATED.test(medicationText)
    );
  },
  apply: () => ({
    domain: "medication",
    evidenceStatus: "route_out",
    ladderLevel: 5,
    decisionType: "route_out",
    route: "prescriber",
    reply: reply(
      "Dose and timing changes are your prescriber's call, not mine — and a prescription is never something I'll treat as an experiment. I recorded the route and time, but no adherence summary or handoff is generated here. Contact your prescriber directly, describe the question, and bring your medication list and dose history.",
      "Prescriber route recorded · no handoff sent",
    ),
    records: [{ kind: "context_note", text: "Prescriber route-out issued." }],
    followUp: null,
    confidenceNote:
      "PRD 11.6 and 7.3: prescription medication is never an experimental variable and dose changes are prescriber-controlled.",
    refused:
      "Ashwini will not suggest a dose, timing, or treatment change, or evaluate whether a prescription is working.",
    choices: [],
    target: null,
    expectedLag: null,
    gated: false,
  }),
};

export const therapyRule: Rule = {
  id: "therapy-content",
  matches: ({ text }) =>
    classifySensitiveContent(text) === "therapy-content" &&
    attributedHealthClauses(text).some(
      (clause) =>
        classifySensitiveContent(clause.text) === "therapy-content" && isOwnerHealthClause(clause),
    ),
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
  musculoskeletalRedFlagRule,
  pregnancyRule,
  skinLesionRule,
  drugDrugRule,
  prescriptionChangeRule,
  // Privacy classification runs independently before persistence. Keeping this
  // rule after every clinical/safety route means protected therapy wording is
  // still discarded without suppressing the route the non-therapy content
  // requires.
  therapyRule,
];

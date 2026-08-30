/**
 * Two halves, and only one of them is live.
 *
 * LIVE — the reducer, from `activeCheckinRecords` down. It folds a list of
 * check-in records into the day's state and applies PRD 4.4's absorbing rules:
 * a safety block stays visible until the record behind it is corrected, and a
 * later routine check-in cannot quietly clear it. It reasons about effects, not
 * about words, so it works unchanged now that those effects come from the server
 * (`lib/checkin-adapter.ts`).
 *
 * NOT LIVE — everything above it, from `urgentFixtures` to
 * `evaluateSyntheticCheckin`. That was the mockup's evaluator, and it decides
 * what a check-in means by exact-string lookup: `urgentFixtures` contains
 * "i have chest pain", so "crushing pressure in my chest" is not urgent to it.
 * It is fine as a fixture player and unusable as a safety layer, which is why
 * the rule pipeline in `domain/advisor` took over that job. Nothing imports it
 * any more.
 *
 * Do not reconnect it to the composer. It is kept for now only because its
 * tests still document the product contract the screens were designed against;
 * removing it, and moving anything still worth keeping into the golden table in
 * `tests/domain`, is tracked as follow-up.
 */

import type {
  CheckinRecord,
  CheckinResponse,
  DerivedDayState,
  PerspectiveContribution,
  TrainingChoice,
} from "@/lib/product-model";
import { hasMeaningfulCheckinInput, withoutCorrectionLabel } from "@/lib/checkin-input";

export { hasMeaningfulCheckinInput } from "@/lib/checkin-input";

const contribution = (
  role: PerspectiveContribution["role"],
  tone: PerspectiveContribution["tone"],
  state: string,
  summary: string,
  basis: string,
): PerspectiveContribution => ({ role, tone, state, summary, basis, origin: "ashwini_synthesis" });

function normalizedScenario(input: string) {
  return withoutCorrectionLabel(input)
    .trim()
    .toLowerCase()
    .replaceAll("’", "'")
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "");
}

function shortInput(input: string) {
  const trimmed = input.trim();
  return trimmed.length > 100 ? `${trimmed.slice(0, 97)}…` : trimmed;
}

const urgentFixtures = new Set([
  "i have chest pain",
  "i can't breathe",
  "i cannot breathe",
  "my face is drooping",
  "i have one-sided weakness",
]);

const prescriptionRouteFixtures = new Set([
  "should i change my prescription dose",
  "can i change my medication",
  "should i stop my medication",
  "can i take these two prescriptions together",
  "is this a drug-drug interaction",
  "should i change my prescription timing",
]);

const unexpectedMedicationFixtures = new Set([
  "i took my medication twice",
  "i may have taken my medication twice",
  "i think my medication caused a side effect",
  "i feel sick after my medication",
]);

const supplementFixtures = new Set([
  "can i add creatine",
  "should i take creatine",
  "can i add magnesium",
  "should i take magnesium",
  "can i add ashwagandha",
  "should i take vitamin d",
]);

const skippedLunchFixtures = new Set([
  "i skipped lunch",
  "i did not eat lunch",
  "i didn't eat lunch",
  "i haven't eaten lunch",
  "i have not eaten lunch",
]);

const vagueLunchFixtures = new Set([
  "i ate lunch",
  "i had lunch",
  "lunch is in",
  "lunch done",
]);

const fatigueFixtures = new Set([
  "i feel flat",
  "i feel tired",
  "i am tired",
  "low energy",
  "energy is low",
  "poor sleep today",
]);

const painFixtures = new Set([
  "my shoulder hurts",
  "i have shoulder pain",
  "my knee hurts",
  "i have knee pain",
  "my back hurts",
  "i have back pain",
]);

const clearTrainingFixtures = new Set([
  "energy normal, shoulder quiet",
  "energy feels normal and my shoulder is quiet",
  "i feel normal and my shoulder is quiet",
  "simulate 3:45 · energy normal, shoulder quiet",
]);

const mealFixtures = new Set([
  "house dal v1 with rice and yogurt",
]);

const neutralMedicationFixtures = new Set([
  "i took my medication",
  "dose taken",
  "i need a refill",
  "my refill is ready",
]);

const recordOnlyReceipt = "Context recorded in this session · no structured plan effect";

const recordOnly = (input: string): CheckinResponse => ({
  kind: "follow-up",
  status: "Recorded",
  gate: "Caveated",
  headline: "Recorded. One detail would make this more useful.",
  acknowledgement: "I have your wording and the time.",
  interpretation: "This synthetic preview recognizes only declared demo scenarios. It did not interpret this as health evidence or change the current recommendation.",
  recommendation: "This preview cannot determine a plan change from that wording. If this is urgent, new, severe, or worsening, seek appropriate human care now rather than relying on this response.",
  followUp: `What matters most about “${shortInput(input)}”: what happened, how you feel, or what you want help deciding?`,
  receipt: recordOnlyReceipt,
  recorded: ["Original wording", "Check-in time", "No structured interpretation"],
  perspectives: [],
  effects: {},
});

function evaluateBaseScenario(rawInput: string): CheckinResponse {
  const input = rawInput.trim();
  if (!hasMeaningfulCheckinInput(input)) {
    throw new Error("A check-in needs meaningful text after the optional correction label.");
  }

  const scenario = normalizedScenario(input);

  if (urgentFixtures.has(scenario)) {
    return {
      kind: "route-out",
      status: "Route out",
      gate: "Blocked",
      headline: "Stop here and seek urgent medical help now.",
      acknowledgement: "You entered a declared urgent demo example.",
      interpretation: "Ashwini cannot assess or monitor an emergency, and this small exact-match demo set is not comprehensive.",
      recommendation: "Call local emergency services or seek immediate in-person medical care. Do not wait for another Ashwini response.",
      receipt: "Urgent demo route-out · original wording retained",
      recorded: ["Original wording", "Check-in time", "Urgent demo route-out"],
      perspectives: [contribution("Care navigation", "care", "Route out", "This belongs with immediate human care, not a lifestyle recommendation.", "Exact declared urgent-demo boundary; no clinical assessment ran.")],
      effects: { trainingGate: "blocked", recommendedTrainingChoice: "pause", attention: "urgent-care" },
    };
  }

  if (prescriptionRouteFixtures.has(scenario) || unexpectedMedicationFixtures.has(scenario)) {
    const unexpectedEvent = unexpectedMedicationFixtures.has(scenario);
    return {
      kind: "route-out",
      status: "Route out",
      gate: "Blocked",
      headline: unexpectedEvent ? "Get medication-specific guidance from a pharmacist or prescriber." : "This needs a pharmacist or prescriber’s judgment.",
      acknowledgement: unexpectedEvent ? "You entered a declared unexpected-dose or possible-side-effect example." : "You entered a declared prescription-decision example.",
      interpretation: "Ashwini can retain exact user wording, but it cannot determine medication safety, interpret side effects, recommend a prescription change, or perform an unsupported drug–drug check.",
      recommendation: unexpectedEvent
        ? "Contact a pharmacist, prescriber, or appropriate urgent service now for advice specific to the medication, dose, timing, and symptoms. Do not take a corrective dose based on this preview."
        : "Keep the current prescription plan unchanged unless the prescribing clinician tells you otherwise, and bring the exact question to them or a pharmacist.",
      receipt: unexpectedEvent ? "Medication event · qualified-human route-out" : "Prescription question · qualified-human route-out",
      recorded: ["Original wording", unexpectedEvent ? "Unexpected medication event" : "Prescription question", "Route-out reason"],
      perspectives: [
        contribution("Medication", "medication", "Protected boundary", "No medication safety or prescription change conclusion is generated.", "Medication decisions require the exact regimen and qualified judgment."),
        contribution("Care navigation", "care", "Route honestly", "Bring the exact medication, dose, timing, and symptom wording to the appropriate human service.", "The synthetic evidence gate is blocked."),
      ],
      effects: unexpectedEvent ? { attention: "medication-event" } : {},
    };
  }

  if (supplementFixtures.has(scenario)) {
    return {
      kind: "route-out",
      status: "Route out",
      gate: "Blocked",
      headline: "No interaction result is available, so I will not guess.",
      acknowledgement: "The declared supplement demo question is worth retaining.",
      interpretation: "This synthetic preview has no authorized safety query, complete regimen, or live result. Missing evidence is not evidence of safety.",
      recommendation: "Ask a pharmacist or prescriber to review the exact supplement, dose, and current medication list before adding it.",
      receipt: "Supplement question retained · no safety result",
      recorded: ["Supplement question", "Authorization unavailable", "Coverage boundary"],
      perspectives: [contribution("Medication", "medication", "No result", "There is no authorized interaction result in this preview.", "Examine Connect remains a future private-service integration."), contribution("Care navigation", "care", "Route honestly", "A pharmacist or prescriber should review the exact regimen.", "The current evidence gate is blocked.")],
      effects: {},
    };
  }

  if (skippedLunchFixtures.has(scenario)) {
    return {
      kind: "recommendation",
      status: "Rule-based",
      gate: "Caveated",
      headline: "Lunch is still open. Keep the next step simple.",
      acknowledgement: "You entered the declared skipped-lunch demo scenario.",
      interpretation: "Training is still later this afternoon, and short sleep remains the only active caution in the synthetic record.",
      recommendation: "If you can eat normally, choose a familiar meal you already tolerate. Do not use this preview to push through nausea, illness, or a new symptom.",
      followUp: "Do you want a familiar fallback from the existing plan, or are you unable to eat because something feels wrong?",
      receipt: "Lunch not recorded · one follow-up",
      recorded: ["Lunch skipped", "Reason not yet known"],
      perspectives: [contribution("Nutrition", "nutrition", "Leading now", "A familiar meal remains the lowest-friction next step if eating normally is appropriate.", "Training is later and no lunch is recorded."), contribution("Recovery", "recovery", "Caution", "Short sleep makes the later energy check more important.", "Sleep is below the synthetic usual range.")],
      effects: { mealStatus: "skipped" },
    };
  }

  if (mealFixtures.has(scenario)) {
    return {
      kind: "recommendation",
      status: "Recorded",
      gate: "Caveated",
      headline: "Lunch is recorded. Hold the training decision until 3:45.",
      acknowledgement: "That exact wording matches the declared House Dal v1 synthetic fixture.",
      interpretation: "The preview uses the declared House Dal v1 synthetic meal fixture—520–720 kcal and 26–38 g protein—not a fresh image analysis or nutritional fact.",
      recommendation: "No more nutrition input is needed before the 3:45 energy and shoulder check unless the fixture is wrong.",
      followUp: "Was this meaningfully different from House Dal v1 in portion, added oil, or protein side?",
      receipt: "Synthetic meal fixture recorded · afternoon plan updated",
      recorded: ["Meal identity: House Dal v1", "Estimated range: 520–720 kcal", "Estimated protein: 26–38 g", "Confidence: fixture-based"],
      perspectives: [contribution("Nutrition", "nutrition", "Recorded", "The declared meal fixture is sufficient for the synthetic trend.", "Exact fixture wording matched House Dal v1; no image analysis ran."), contribution("Training", "training", "Plan held", "The final volume choice still waits for the 3:45 check-in.", "Lunch is covered; short sleep remains relevant.")],
      effects: { mealStatus: "recorded" },
    };
  }

  if (vagueLunchFixtures.has(scenario)) {
    return {
      kind: "follow-up",
      status: "Recorded",
      gate: "Caveated",
      headline: "Lunch happened. One detail is still missing.",
      acknowledgement: "I have the declared lunch-occurrence demo event.",
      interpretation: "A meal cannot be estimated from that sentence alone, so I have not invented calories or protein.",
      recommendation: "Keep the current training plan unchanged while the meal detail remains open.",
      followUp: "What did you have? A short description is enough; no recipe is required.",
      receipt: "Lunch occurrence recorded · detail needed",
      recorded: ["Lunch occurred", "Meal contents unknown", "No nutrition estimate"],
      perspectives: [contribution("Nutrition", "nutrition", "Needs one detail", "The occurrence is recorded without a calorie or protein estimate.", "No meal description or image analysis is available."), contribution("Training", "training", "No change", "The 3:45 check remains the decision point.", "Lunch occurred, but the current record does not support a stronger inference.")],
      effects: { mealStatus: "needs-detail" },
    };
  }

  if (fatigueFixtures.has(scenario)) {
    return {
      kind: "recommendation",
      status: "Rule-based",
      gate: "Caveated",
      headline: "Low energy makes reduced volume the better default.",
      acknowledgement: "You entered the declared low-energy demo scenario.",
      interpretation: "Paired with short sleep, this meets the declared synthetic rule for favoring the reduced-volume version. It does not explain why energy is low.",
      recommendation: "Keep the session optional and choose the reduced-volume plan unless energy clearly rebounds. New, severe, or worsening symptoms belong with a qualified professional.",
      receipt: "Energy change recorded · reduced volume favored",
      recorded: ["Low energy", "Short sleep already present", "Rule v0.2 applied"],
      perspectives: [contribution("Recovery", "recovery", "Leading now", "Low energy plus short sleep activates the caution rule.", "Morning sleep and the declared current-energy fixture are both present."), contribution("Training", "training", "Plan adjusted", "Reduced volume is favored; the user still chooses whether to train.", "Synthetic rule v0.2, not a medical clearance.")],
      effects: { trainingGate: "caution", recommendedTrainingChoice: "reduced" },
    };
  }

  if (painFixtures.has(scenario)) {
    return {
      kind: "route-out",
      status: "Route out",
      gate: "Blocked",
      headline: "Do not use this preview to test pain under load.",
      acknowledgement: "You entered a declared pain demo scenario.",
      interpretation: "Text alone cannot determine the cause, severity, or whether training is appropriate.",
      recommendation: "Pause the painful loaded movement. If this is new, worsening, severe, or limiting normal movement, seek qualified clinical guidance.",
      followUp: "Is it new or worsening, and is normal movement limited?",
      receipt: "Pain demo event · training verdict blocked",
      recorded: ["Original symptom wording", "Training gate: blocked", "Follow-up needed"],
      perspectives: [contribution("Training", "training", "Blocked", "No loaded-movement recommendation is generated from symptom text.", "The evidence gate is blocked."), contribution("Care navigation", "care", "Human judgment", "Escalate new, worsening, severe, or function-limiting symptoms.", "A qualified professional needs more context and examination when appropriate.")],
      effects: { trainingGate: "blocked", recommendedTrainingChoice: "pause" },
    };
  }

  if (clearTrainingFixtures.has(scenario)) {
    return {
      kind: "recommendation",
      status: "Rule-based",
      gate: "Clear",
      headline: "The declared 3:45 check is clear. Full volume is available.",
      acknowledgement: "You entered the declared normal-energy and quiet-shoulder demo scenario.",
      interpretation: "With lunch handled separately and no caution fixture active in this current check, the synthetic rule allows the existing full-volume plan. This is not medical clearance.",
      recommendation: "Choose full, reduced, or pause in Plan based on the session you want to run; stop and route out if the facts change.",
      receipt: "Pre-session demo check clear · plan choice available",
      recorded: ["Energy: normal", "Shoulder: quiet", "Training gate: clear", "Rule v0.2 applied"],
      perspectives: [contribution("Recovery", "recovery", "Current check clear", "The declared current-energy fixture does not activate the caution rule.", "Exact synthetic 3:45 fixture only."), contribution("Training", "training", "Choice available", "The existing full or reduced plan may be selected by the user.", "Rule-based synthetic plan; no medical clearance.")],
      effects: { trainingGate: "clear", recommendedTrainingChoice: "hold", scenarioPhase: "pre-session" },
    };
  }

  if (neutralMedicationFixtures.has(scenario)) {
    return {
      kind: "record",
      status: "Recorded",
      gate: "Caveated",
      headline: "Medication wording recorded without changing the prescription plan.",
      acknowledgement: "I retained the exact declared adherence or refill demo wording.",
      interpretation: "This records only what was reported. It does not verify that a dose was taken, infer efficacy, or establish medication safety.",
      recommendation: "Keep prescription decisions with the prescriber or pharmacist.",
      receipt: "Medication context recorded · no prescription advice",
      recorded: ["Original wording", "Medication lane", "User-reported only", "No plan change"],
      perspectives: [contribution("Medication", "medication", "Recorded only", "The wording is retained without inferring adherence, efficacy, or safety beyond what was supplied.", "Prescription decisions remain outside Ashwini’s authority.")],
      effects: {},
    };
  }

  return recordOnly(input);
}

function protectedResponse(response: CheckinResponse, state: DerivedDayState): CheckinResponse {
  const urgent = state.attention === "urgent-care";
  const medication = state.attention === "medication-event";
  const unmatchedWording = response.receipt === recordOnlyReceipt;
  const protectedLabel = urgent ? "urgent-care handoff" : medication ? "medication-guidance handoff" : "training block";
  const receiptLead = response.receipt.startsWith("Correction")
    ? "Correction recorded · target effect recalculated"
    : Object.keys(response.effects).length > 0
      ? "Lower-priority fixture effect retained"
      : "Check-in retained without a plan effect";

  return {
    kind: "route-out",
    status: "Route out",
    gate: "Blocked",
    headline: urgent
      ? "The urgent human-care handoff remains the next step."
      : medication
        ? "The medication-guidance handoff remains the next step."
        : "The existing training block remains in control.",
    acknowledgement: `${response.acknowledgement} The ${protectedLabel} is still open.`,
    interpretation: `The new wording and any declared lower-priority fixture effect were retained, but they cannot replace or resolve the active protected state.${unmatchedWording ? " This exact-match preview did not interpret the new wording, and its declared fixture set is not a safety classifier." : ""}`,
    recommendation: `${urgent
      ? "Keep routine planning stopped and follow the urgent human-care route already shown."
      : medication
        ? "Keep routine planning withheld and get the medication-specific guidance already shown."
        : "Keep loaded training paused and follow the human-guidance route already shown."}${unmatchedWording ? " If the new wording describes something urgent, new, severe, or worsening, seek appropriate human care now rather than relying on this preview." : ""}`,
    receipt: `${receiptLead} · ${urgent || medication ? "human handoff" : "active block"} unchanged`,
    recorded: [...response.recorded.map((item) => `Deferred · ${item}`), `Active ${protectedLabel} retained`],
    perspectives: urgent
      ? [contribution("Care navigation", "care", "Still urgent", "The urgent human-care route remains the next step.", "A lower-priority check-in cannot resolve an urgent-care handoff.")]
      : medication
        ? [contribution("Medication", "medication", "Handoff open", "The new check-in does not answer the medication question.", "Medication safety still requires the exact regimen and qualified judgment."), contribution("Care navigation", "care", "Still primary", "The existing qualified-human route remains the next step.", "A lower-priority check-in is not a resolution event.")]
        : [contribution("Training", "training", "Still blocked", "The new check-in cannot override the active block.", "Blocked gates are absorbing until the blocking record is explicitly corrected or undone."), contribution("Care navigation", "care", "Human judgment", "The existing route to appropriate human guidance remains active.", "Another synthetic check-in is not a resolution event.")],
    effects: response.effects,
    deferredPlanResponse: response,
  };
}

function mealResponseAfterTrainingDecision(response: CheckinResponse, state: DerivedDayState): CheckinResponse {
  const mealStatus = response.effects.mealStatus;
  const clear = state.trainingGate === "clear";
  const gateLabel = clear ? "clear demo gate" : "caution rule";
  const mealInterpretation = mealStatus === "skipped"
    ? "Lunch is not recorded and the reason remains unknown. This meal check-in does not determine why eating was difficult or appropriate."
    : response.interpretation;
  const headline = mealStatus === "recorded"
    ? "Lunch is recorded. The pre-session training state is unchanged."
    : mealStatus === "needs-detail"
      ? "Lunch happened. One detail is still missing; the pre-session state is unchanged."
      : "Lunch is still open. The pre-session training state is unchanged.";

  return {
    ...response,
    headline,
    interpretation: `${mealInterpretation} Separately, the ${gateLabel} is already active; this meal check-in does not rewind or replace it.`,
    recommendation: clear
      ? "Finish any meal follow-up that is still open. Full, reduced, or pause remain available in Plan as user choices; none is medical clearance or a requirement to train."
      : "Finish any meal follow-up that is still open. Reduced volume remains favored by the existing caution rule, and the session remains optional.",
    receipt: `${response.receipt} · ${gateLabel} retained`,
    recorded: [...response.recorded, `Existing ${gateLabel} retained`],
    perspectives: [
      ...response.perspectives.filter((item) => item.role === "Nutrition"),
      contribution(
        "Training",
        "training",
        clear ? "Choice still available" : "Caution retained",
        clear ? "The existing full, reduced, or pause choices remain available." : "The existing reduced-volume recommendation remains active and optional.",
        `The meal update does not replace the prior ${gateLabel}.`,
      ),
    ],
    deferredPlanResponse: response,
  };
}

function reconcileCurrentState(response: CheckinResponse, state?: DerivedDayState): CheckinResponse {
  if (!state) return response;

  if (!planIsLocked(state)) {
    const updatesMealOnly = Boolean(response.effects.mealStatus) && !response.effects.trainingGate;
    if (updatesMealOnly && (state.trainingGate === "clear" || state.trainingGate === "caution")) {
      return mealResponseAfterTrainingDecision(response, state);
    }
    return response;
  }

  const escalatesToUrgent = response.effects.attention === "urgent-care";
  const addsMedicationAttention = state.attention === "none" && response.effects.attention === "medication-event";
  const addsFirstTrainingBlock = state.attention === "none"
    && state.trainingGate !== "blocked"
    && response.effects.trainingGate === "blocked";
  const independentRouteOut = state.attention === "none" && response.kind === "route-out";

  if (escalatesToUrgent || addsMedicationAttention || addsFirstTrainingBlock || independentRouteOut) return response;
  return protectedResponse(response, state);
}

interface EvaluationContext {
  currentState?: DerivedDayState;
  correctedRecord?: CheckinRecord;
}

function correctionWithoutReplacement(correctedRecord: CheckinRecord): CheckinResponse {
  const removedStructuredEffect = Object.keys(correctedRecord.response.effects).length > 0;
  const preservedPhase = correctedRecord.response.effects.scenarioPhase === "pre-session"
    ? { scenarioPhase: "pre-session" as const }
    : {};
  return {
    kind: "record",
    status: "Recorded",
    gate: "Caveated",
    headline: removedStructuredEffect
      ? "Correction recorded. The previous structured effect is no longer active."
      : "Correction recorded. The previous entry is now superseded.",
    acknowledgement: "The original remains visible in history and is marked as superseded.",
    interpretation: removedStructuredEffect
      ? "No declared replacement fixture matched this correction, so Ashwini recalculated the session without the prior structured effect. It did not infer a replacement fact."
      : "No declared replacement fixture matched this correction, so no new health interpretation or plan effect was added.",
    recommendation: "Add the corrected fact in a new check-in if it should change the plan again.",
    followUp: `What should replace “${shortInput(correctedRecord.originalInput)}”?`,
    receipt: removedStructuredEffect
      ? "Correction recorded · previous effect removed · plan recalculated"
      : "Correction recorded · previous entry superseded · no new plan effect",
    recorded: ["Correction wording", "Superseded record retained", removedStructuredEffect ? "Previous structured effect removed" : "No replacement interpretation"],
    perspectives: [],
    effects: preservedPhase,
  };
}

export function evaluateSyntheticCheckin(rawInput: string, context: EvaluationContext = {}): CheckinResponse {
  const baseResponse = evaluateBaseScenario(rawInput);

  if (context.correctedRecord && baseResponse.receipt === recordOnlyReceipt) {
    return reconcileCurrentState(correctionWithoutReplacement(context.correctedRecord), context.currentState);
  }

  if (!context.correctedRecord) return reconcileCurrentState(baseResponse, context.currentState);

  const correctedResponse: CheckinResponse = {
    ...baseResponse,
    acknowledgement: `Correction accepted. ${baseResponse.acknowledgement}`,
    receipt: `Correction applied · ${baseResponse.receipt}`,
    recorded: ["Correction of prior check-in", ...baseResponse.recorded],
    effects: context.correctedRecord.response.effects.scenarioPhase === "pre-session"
      ? { ...baseResponse.effects, scenarioPhase: "pre-session" }
      : baseResponse.effects,
  };

  return reconcileCurrentState(correctedResponse, context.currentState);
}

export function activeCheckinRecords(records: readonly CheckinRecord[], additionallySuperseded: readonly string[] = []) {
  const superseded = new Set([
    ...additionallySuperseded,
    ...records.flatMap((record) => record.correctionOf ? [record.correctionOf] : []),
  ]);
  return records.filter((record) => !superseded.has(record.id));
}

export function deriveDayState(records: readonly CheckinRecord[], additionallySuperseded: readonly string[] = []): DerivedDayState {
  const active = activeCheckinRecords(records, additionallySuperseded);
  const state = active.reduce<DerivedDayState>((current, record) => ({
    mealStatus: record.response.effects.mealStatus ?? current.mealStatus,
    trainingGate: record.response.effects.trainingGate ?? current.trainingGate,
    recommendedTrainingChoice: record.response.effects.recommendedTrainingChoice ?? current.recommendedTrainingChoice,
    attention: record.response.effects.attention ?? current.attention,
    scenarioPhase: record.response.effects.scenarioPhase ?? current.scenarioPhase,
  }), {
    mealStatus: "missing",
    trainingGate: "pending",
    recommendedTrainingChoice: "hold",
    attention: "none",
    scenarioPhase: "midday",
  });

  const hasBlockedGate = active.some((record) => record.response.effects.trainingGate === "blocked");
  const hasUrgentAttention = active.some((record) => record.response.effects.attention === "urgent-care");
  const hasMedicationAttention = active.some((record) => record.response.effects.attention === "medication-event");

  return {
    ...state,
    trainingGate: hasBlockedGate ? "blocked" : state.trainingGate,
    recommendedTrainingChoice: hasBlockedGate ? "pause" : state.recommendedTrainingChoice,
    attention: hasUrgentAttention ? "urgent-care" : hasMedicationAttention ? "medication-event" : "none",
  };
}

export function activeDecisionRecord(records: readonly CheckinRecord[], state = deriveDayState(records)) {
  const active = activeCheckinRecords(records);

  if (state.attention !== "none") {
    return [...active].reverse().find((record) => record.response.effects.attention === state.attention);
  }

  if (state.trainingGate !== "pending") {
    return [...active].reverse().find((record) => record.response.effects.trainingGate === state.trainingGate);
  }

  if (state.mealStatus !== "missing") {
    return [...active].reverse().find((record) => record.response.effects.mealStatus === state.mealStatus);
  }

  return undefined;
}

export function responseForActiveDecision(record: CheckinRecord) {
  return record.response.deferredPlanResponse ?? record.response;
}

export function planIsLocked(state: DerivedDayState) {
  return state.trainingGate === "blocked" || state.attention !== "none";
}

export function selectionForState(state: DerivedDayState, manualChoice: TrainingChoice | null) {
  if (planIsLocked(state)) return { choice: "pause" as const, source: "gate" as const };
  if (manualChoice) return { choice: manualChoice, source: "user" as const };
  return { choice: state.recommendedTrainingChoice, source: "rule" as const };
}

export function chooseTrainingForState(
  state: DerivedDayState,
  manualChoice: TrainingChoice | null,
  choice: TrainingChoice,
) {
  if (planIsLocked(state)) {
    return {
      manualChoice,
      receipt: choice === "pause"
        ? "Loaded training remains paused while the current handoff is open. No user choice resolves this gate."
        : "The current handoff keeps this training choice unavailable.",
    };
  }

  if (choice === "full" && state.trainingGate !== "clear") {
    return {
      manualChoice,
      receipt: "Full volume stays unavailable until the training gate is clear.",
    };
  }

  const current = selectionForState(state, manualChoice);
  if (current.source === "rule" && current.choice === choice) {
    return {
      manualChoice: null,
      receipt: "The current rule already holds this selection. No user plan choice changed.",
    };
  }

  return {
    manualChoice: choice,
    receipt: choice === "hold" && state.trainingGate === "clear"
      ? "The training decision remains open by your choice."
      : recommendationForChoice(choice),
  };
}

export function checkinTouchesPlanGate(record: CheckinRecord, correctedRecord?: CheckinRecord) {
  const touches = (candidate?: CheckinRecord) => Boolean(
    candidate?.response.effects.trainingGate || candidate?.response.effects.attention,
  );
  return touches(record) || touches(correctedRecord);
}

export function manualChoiceAfterGateChange(choice: TrainingChoice | null) {
  return choice === "pause" ? choice : null;
}

export function recommendationForChoice(choice: TrainingChoice) {
  switch (choice) {
    case "full": return "Full volume selected for this session. It is a user choice, not medical clearance.";
    case "reduced": return "Reduced volume selected. The session remains optional, not medically cleared.";
    case "pause": return "Loaded training is paused by your choice.";
    default: return "The session is held on the calendar. Make the volume choice when you are ready.";
  }
}

import assert from "node:assert/strict";
import { test } from "vitest";
import type { CheckinRecord } from "../lib/product-model.ts";
import {
  activeDecisionRecord,
  checkinTouchesPlanGate,
  chooseTrainingForState,
  deriveDayState,
  evaluateSyntheticCheckin,
  hasMeaningfulCheckinInput,
  manualChoiceAfterGateChange,
  recommendationForChoice,
  responseForActiveDecision,
  selectionForState,
} from "../lib/synthetic-scenario.ts";

function record(id: string, input: string, correctionOf?: string): CheckinRecord {
  return {
    id,
    time: "12:18 PM",
    originalInput: input,
    modality: "text",
    correctionOf,
    response: evaluateSyntheticCheckin(input),
  };
}

test("vague lunch input never fabricates a nutrition estimate", () => {
  const result = evaluateSyntheticCheckin("I ate lunch");
  assert.equal(result.effects.mealStatus, "needs-detail");
  assert.match(result.interpretation, /not invented calories or protein/i);
  assert.doesNotMatch(result.interpretation, /520|720|26|38/);
});

test("skipping lunch does not mark lunch recorded", () => {
  const result = evaluateSyntheticCheckin("I skipped lunch");
  assert.equal(result.effects.mealStatus, "skipped");
  assert.equal(result.kind, "recommendation");
});

test("the declared meal fixture is the only text path to a meal range", () => {
  const result = evaluateSyntheticCheckin("House Dal v1 with rice and yogurt");
  assert.equal(result.effects.mealStatus, "recorded");
  assert.match(result.interpretation, /synthetic meal fixture/i);
  assert.match(result.interpretation, /520–720/);
});

test("fixture prefixes and adverse-context suffixes never create a meal estimate", () => {
  for (const input of [
    "House Dal v1 was not what I ate",
    "House Dal v1 with an unknown recipe",
    "House Dal v1 made me sick",
  ]) {
    const result = evaluateSyntheticCheckin(input);
    assert.deepEqual(result.effects, {}, input);
    assert.doesNotMatch(
      `${result.interpretation} ${result.recorded.join(" ")}`,
      /520|720|26|38/,
      input,
    );
  }
});

test("supplement questions never imply a queued or completed safety check", () => {
  const result = evaluateSyntheticCheckin("Can I add creatine?");
  assert.equal(result.status, "Route out");
  assert.equal(result.gate, "Blocked");
  assert.doesNotMatch(
    `${result.headline} ${result.interpretation} ${result.receipt}`,
    /queued|compatible|safe to take/i,
  );
});

test("prescription changes route to a qualified human", () => {
  const result = evaluateSyntheticCheckin("Should I change my prescription dose?");
  assert.equal(result.status, "Route out");
  assert.equal(result.gate, "Blocked");
  assert.match(result.recommendation, /prescribing clinician|pharmacist/i);
});

test("arbitrary text is recorded without generating health advice", () => {
  const result = evaluateSyntheticCheckin("The afternoon felt different");
  assert.equal(result.status, "Recorded");
  assert.equal(result.kind, "follow-up");
  assert.deepEqual(result.effects, {});
});

test("an empty correction label cannot supersede a record", () => {
  const pain = record("ci_pain", "My shoulder hurts");

  assert.equal(hasMeaningfulCheckinInput("Correction: "), false);
  assert.throws(
    () =>
      evaluateSyntheticCheckin("Correction: ", {
        currentState: deriveDayState([]),
        correctedRecord: pain,
      }),
    /meaningful text/i,
  );
});

test("correction-label spacing cannot turn a declared replacement into a withdrawal", () => {
  const meal = record("ci_meal", "House Dal v1 with rice and yogurt");
  const response = evaluateSyntheticCheckin("Correction : My shoulder hurts", {
    currentState: deriveDayState([]),
    correctedRecord: meal,
  });

  assert.equal(response.effects.trainingGate, "blocked");
  assert.match(response.receipt, /correction applied/i);
  assert.doesNotMatch(response.receipt, /previous effect removed/i);
});

test("unmatched wording never endorses the existing plan and retains the urgent-care boundary", () => {
  const result = evaluateSyntheticCheckin("I am vomiting blood");
  assert.equal(result.status, "Recorded");
  assert.match(result.recommendation, /cannot determine a plan change/i);
  assert.match(result.recommendation, /urgent|severe|human care/i);
  assert.doesNotMatch(result.recommendation, /leave|continue|keep the current plan/i);
});

test("every exposed perspective is explicitly Ashwini synthesis", () => {
  const result = evaluateSyntheticCheckin("I feel flat");
  assert.ok(result.perspectives.length > 0);
  assert.ok(result.perspectives.every((perspective) => perspective.origin === "ashwini_synthesis"));
});

test("negation and unrelated substrings do not create health state", () => {
  for (const input of [
    "I am not tired",
    "My shoulder no longer hurts",
    "No shoulder pain",
    "I have back-to-back meetings",
  ]) {
    const result = evaluateSyntheticCheckin(input);
    assert.deepEqual(result.effects, {}, input);
    assert.equal(result.status, "Recorded", input);
  }
});

test("a negated fixture name never creates a meal estimate", () => {
  const result = evaluateSyntheticCheckin("I ate lunch but it was not House Dal v1");
  assert.deepEqual(result.effects, {});
  assert.doesNotMatch(`${result.interpretation} ${result.recorded.join(" ")}`, /520|720|26|38/);
});

test("unexpected medication events route to qualified human judgment", () => {
  const result = evaluateSyntheticCheckin("I took my medication twice");
  assert.equal(result.status, "Route out");
  assert.equal(result.gate, "Blocked");
  assert.match(result.recommendation, /pharmacist|prescriber|urgent service/i);
  assert.equal(result.effects.attention, "medication-event");
});

test("an unexpected medication event remains the active decision after an unrelated plan record", () => {
  const meal = record("ci_meal", "House Dal v1 with rice and yogurt");
  const medication = record("ci_medication", "I took my medication twice");
  const laterMealDetail = record("ci_detail", "I ate lunch");
  const records = [meal, medication, laterMealDetail];

  assert.equal(deriveDayState(records).attention, "medication-event");
  assert.equal(activeDecisionRecord(records)?.id, medication.id);
});

test("the declared pre-session fixture opens the plan choice without implying clearance", () => {
  const result = evaluateSyntheticCheckin("Energy normal, shoulder quiet");
  assert.equal(result.effects.trainingGate, "clear");
  assert.equal(result.effects.recommendedTrainingChoice, "hold");
  assert.equal(result.effects.scenarioPhase, "pre-session");
  assert.match(result.interpretation, /not medical clearance/i);
});

test("a later clear fixture cannot override an active pain or urgent block", () => {
  for (const blockedInput of ["My shoulder hurts", "I have chest pain"]) {
    const blocked = record(`ci_blocked_${blockedInput}`, blockedInput);
    const blockedState = deriveDayState([blocked]);
    const response = evaluateSyntheticCheckin("Energy normal, shoulder quiet", {
      currentState: blockedState,
    });
    const laterCheck: CheckinRecord = {
      id: `ci_clear_${blockedInput}`,
      time: "3:45 PM",
      originalInput: "Energy normal, shoulder quiet",
      modality: "text",
      response,
    };

    assert.equal(response.effects.trainingGate, "clear", blockedInput);
    assert.match(
      response.receipt,
      blockedState.attention === "none" ? /active block unchanged/i : /human handoff unchanged/i,
      blockedInput,
    );
    assert.doesNotMatch(
      response.receipt,
      /plan choice available|full volume|clear demo check/i,
      blockedInput,
    );
    assert.doesNotMatch(
      response.recommendation,
      /choose full|choose reduced|full volume is available/i,
      blockedInput,
    );
    assert.equal(deriveDayState([blocked, laterCheck]).trainingGate, "blocked", blockedInput);
  }
});

test("blocked gates are absorbing even if evaluation context is accidentally omitted", () => {
  const pain = record("ci_pain", "My shoulder hurts");
  const clear = record("ci_clear", "Energy normal, shoulder quiet");
  assert.equal(deriveDayState([pain, clear]).trainingGate, "blocked");
  assert.equal(deriveDayState([pain, clear]).recommendedTrainingChoice, "pause");
});

test("corrections supersede state without erasing the original record", () => {
  const original = record("ci_original", "House Dal v1 with rice and yogurt");
  const correction = record("ci_correction", "Correction: I skipped lunch", original.id);
  const records = [original, correction];

  assert.equal(deriveDayState(records).mealStatus, "skipped");
  assert.equal(records.length, 2);
  assert.equal(correction.correctionOf, original.id);
});

test("an unstructured correction explicitly reports that the prior effect was withdrawn", () => {
  const original = record("ci_original", "House Dal v1 with rice and yogurt");
  const response = evaluateSyntheticCheckin("Correction: that was wrong", {
    currentState: deriveDayState([original]),
    correctedRecord: original,
  });
  const correction: CheckinRecord = {
    id: "ci_correction",
    time: "12:18 PM",
    originalInput: "Correction: that was wrong",
    modality: "text",
    correctionOf: original.id,
    response,
  };

  assert.equal(deriveDayState([original, correction]).mealStatus, "missing");
  assert.match(response.receipt, /previous effect removed · plan recalculated/i);
  assert.doesNotMatch(
    `${response.interpretation} ${response.recommendation}`,
    /no plan change|leave the current plan unchanged/i,
  );
});

test("explicitly correcting a blocking record removes the block without inventing a replacement", () => {
  const pain = record("ci_pain", "My shoulder hurts");
  const response = evaluateSyntheticCheckin("Correction: that was wrong", {
    currentState: deriveDayState([]),
    correctedRecord: pain,
  });
  const correction: CheckinRecord = {
    id: "ci_pain_correction",
    time: "12:18 PM",
    originalInput: "Correction: that was wrong",
    modality: "text",
    correctionOf: pain.id,
    response,
  };

  assert.equal(deriveDayState([pain, correction]).trainingGate, "pending");
  assert.match(response.receipt, /previous effect removed/i);
});

test("a declared replacement can clear the exact blocking record it corrects", () => {
  const pain = record("ci_pain", "My shoulder hurts");
  const response = evaluateSyntheticCheckin("Correction: Energy normal, shoulder quiet", {
    currentState: deriveDayState([]),
    correctedRecord: pain,
  });
  const correction: CheckinRecord = {
    id: "ci_pain_replacement",
    time: "3:45 PM",
    originalInput: "Correction: Energy normal, shoulder quiet",
    modality: "text",
    correctionOf: pain.id,
    response,
  };

  assert.equal(deriveDayState([pain, correction]).trainingGate, "clear");
  assert.match(response.receipt, /correction applied/i);
  assert.doesNotMatch(response.receipt, /block unchanged/i);
});

test("correcting the pre-session fixture does not rewind the synthetic clock", () => {
  const clear = record("ci_clear", "Energy normal, shoulder quiet");
  const response = evaluateSyntheticCheckin("Correction: that was wrong", {
    currentState: deriveDayState([]),
    correctedRecord: clear,
  });
  const correction: CheckinRecord = {
    id: "ci_clear_correction",
    time: "3:45 PM",
    originalInput: "Correction: that was wrong",
    modality: "text",
    correctionOf: clear.id,
    response,
  };

  assert.equal(deriveDayState([clear, correction]).scenarioPhase, "pre-session");
  assert.equal(deriveDayState([clear, correction]).trainingGate, "pending");
});

test("correcting one blocker cannot clear another active blocker", () => {
  const pain = record("ci_pain", "My shoulder hurts");
  const urgent = record("ci_urgent", "I have chest pain");
  const response = evaluateSyntheticCheckin("Correction: Energy normal, shoulder quiet", {
    currentState: deriveDayState([urgent]),
    correctedRecord: pain,
  });
  const correction: CheckinRecord = {
    id: "ci_pain_replacement",
    time: "3:45 PM",
    originalInput: "Correction: Energy normal, shoulder quiet",
    modality: "text",
    correctionOf: pain.id,
    response,
  };

  assert.equal(deriveDayState([pain, urgent, correction]).trainingGate, "blocked");
  assert.match(response.receipt, /human handoff unchanged/i);
  assert.doesNotMatch(response.receipt, /plan choice available|clear demo check/i);
});

test("routine effects are retained without burying an open medication handoff", () => {
  const medication = record("ci_medication", "I took my medication twice");
  const response = evaluateSyntheticCheckin("I feel flat", {
    currentState: deriveDayState([medication]),
  });
  const fatigue: CheckinRecord = {
    id: "ci_fatigue",
    time: "12:18 PM",
    originalInput: "I feel flat",
    modality: "text",
    response,
  };
  const state = deriveDayState([medication, fatigue]);

  assert.equal(response.effects.trainingGate, "caution");
  assert.match(response.deferredPlanResponse?.headline ?? "", /low energy/i);
  assert.equal(response.kind, "route-out");
  assert.match(response.receipt, /human handoff unchanged/i);
  assert.doesNotMatch(response.receipt, /reduced volume favored/i);
  assert.match(response.recommendation, /medication-specific guidance/i);
  assert.doesNotMatch(response.recommendation, /choose the reduced-volume plan/i);
  assert.equal(state.attention, "medication-event");
  assert.equal(state.trainingGate, "caution");
  assert.equal(selectionForState(state, null).choice, "pause");
});

test("deferred reasoning becomes the active provenance only after its handoff is corrected", () => {
  const medication = record("ci_medication", "I took my medication twice");
  const fatigueResponse = evaluateSyntheticCheckin("I feel flat", {
    currentState: deriveDayState([medication]),
  });
  const fatigue: CheckinRecord = {
    id: "ci_fatigue",
    time: "12:18 PM",
    originalInput: "I feel flat",
    modality: "text",
    response: fatigueResponse,
  };
  const stateWithoutMedication = deriveDayState([medication, fatigue], [medication.id]);
  const correctionResponse = evaluateSyntheticCheckin("Correction: that was wrong", {
    currentState: stateWithoutMedication,
    correctedRecord: medication,
  });
  const correction: CheckinRecord = {
    id: "ci_medication_correction",
    time: "12:18 PM",
    originalInput: "Correction: that was wrong",
    modality: "text",
    correctionOf: medication.id,
    response: correctionResponse,
  };
  const records = [medication, fatigue, correction];
  const state = deriveDayState(records);
  const decision = activeDecisionRecord(records, state);

  assert.equal(state.attention, "none");
  assert.equal(state.trainingGate, "caution");
  assert.equal(decision?.id, fatigue.id);
  assert.match(decision ? responseForActiveDecision(decision).headline : "", /low energy/i);
  assert.ok(
    decision &&
      responseForActiveDecision(decision).perspectives.some((item) => item.role === "Recovery"),
  );
});

test("meal state is retained without burying an active pain block", () => {
  const pain = record("ci_pain", "My shoulder hurts");
  const response = evaluateSyntheticCheckin("House Dal v1 with rice and yogurt", {
    currentState: deriveDayState([pain]),
  });
  const meal: CheckinRecord = {
    id: "ci_meal",
    time: "12:18 PM",
    originalInput: "House Dal v1 with rice and yogurt",
    modality: "text",
    response,
  };
  const state = deriveDayState([pain, meal]);

  assert.equal(response.effects.mealStatus, "recorded");
  assert.equal(response.kind, "route-out");
  assert.match(response.receipt, /active block unchanged/i);
  assert.doesNotMatch(response.receipt, /afternoon plan updated/i);
  assert.match(response.recommendation, /loaded training paused/i);
  assert.equal(state.mealStatus, "recorded");
  assert.equal(state.trainingGate, "blocked");
});

test("an unmatched input keeps the urgent-care boundary behind every protected state", () => {
  for (const protectedInput of ["My shoulder hurts", "I took my medication twice"]) {
    const protectedRecord = record(`ci_protected_${protectedInput}`, protectedInput);
    const response = evaluateSyntheticCheckin("I am vomiting blood", {
      currentState: deriveDayState([protectedRecord]),
    });

    assert.match(response.recommendation, /urgent, new, severe, or worsening/i, protectedInput);
    assert.match(response.recommendation, /appropriate human care now/i, protectedInput);
    assert.match(response.interpretation, /not a safety classifier/i, protectedInput);
    assert.match(response.receipt, /unchanged/i, protectedInput);
  }
});

test("a meal update after the clear pre-session check does not rewind its response copy", () => {
  const clear = record("ci_clear", "Energy normal, shoulder quiet");
  const response = evaluateSyntheticCheckin("House Dal v1 with rice and yogurt", {
    currentState: deriveDayState([clear]),
  });
  const meal: CheckinRecord = {
    id: "ci_meal",
    time: "3:45 PM",
    originalInput: "House Dal v1 with rice and yogurt",
    modality: "text",
    response,
  };
  const state = deriveDayState([clear, meal]);

  assert.equal(state.trainingGate, "clear");
  assert.equal(state.mealStatus, "recorded");
  assert.match(response.headline, /pre-session training state is unchanged/i);
  assert.match(response.receipt, /clear demo gate retained/i);
  assert.doesNotMatch(
    `${response.headline} ${response.recommendation}`,
    /hold.*until 3:45|before the 3:45 check/i,
  );
  assert.match(
    response.deferredPlanResponse?.headline ?? "",
    /hold the training decision until 3:45/i,
  );
});

test("a meal update after a caution state preserves reduced-volume copy", () => {
  const fatigue = record("ci_fatigue", "I feel flat");
  const response = evaluateSyntheticCheckin("I ate lunch", {
    currentState: deriveDayState([fatigue]),
  });
  const state = deriveDayState([
    fatigue,
    {
      id: "ci_meal",
      time: "12:18 PM",
      originalInput: "I ate lunch",
      modality: "text",
      response,
    },
  ]);

  assert.equal(state.trainingGate, "caution");
  assert.match(response.receipt, /caution rule retained/i);
  assert.match(response.recommendation, /reduced volume remains favored/i);
  assert.doesNotMatch(response.recommendation, /hold.*until 3:45/i);
});

test("an active training block does not hide a new prescription or supplement route-out", () => {
  const pain = record("ci_pain", "My shoulder hurts");
  const state = deriveDayState([pain]);

  for (const input of ["Should I change my prescription dose?", "Can I add creatine?"]) {
    const response = evaluateSyntheticCheckin(input, { currentState: state });
    assert.equal(response.kind, "route-out", input);
    assert.match(response.recommendation, /pharmacist|prescribing clinician|prescriber/i, input);
    assert.ok(
      response.perspectives.some((item) => item.role === "Medication"),
      input,
    );
    assert.doesNotMatch(response.headline, /existing training block remains/i, input);
  }
});

test("a non-plan question does not replace the record supporting Today", () => {
  const meal = record("ci_meal", "House Dal v1 with rice and yogurt");
  const supplement = record("ci_supplement", "Can I add creatine?");
  const records = [meal, supplement];

  assert.equal(activeDecisionRecord(records)?.id, meal.id);
});

test("voluntary pause language remains distinct from a safety block", () => {
  const receipt = recommendationForChoice("pause");
  assert.match(receipt, /your choice/i);
  assert.doesNotMatch(receipt, /blocked|human guidance|symptom/i);
});

test("choosing the already-effective rule selection is idempotent", () => {
  const state = deriveDayState([]);
  const result = chooseTrainingForState(state, null, "hold");

  assert.equal(result.manualChoice, null);
  assert.match(result.receipt, /no user plan choice changed/i);
  assert.deepEqual(selectionForState(state, result.manualChoice), {
    choice: "hold",
    source: "rule",
  });
});

test("choosing hold once the gate is clear does not read as still waiting", () => {
  const clear = record("ci_clear", "Energy normal, shoulder quiet");
  const state = deriveDayState([clear]);
  const full = chooseTrainingForState(state, null, "full");
  const hold = chooseTrainingForState(state, full.manualChoice, "hold");

  assert.equal(hold.manualChoice, "hold");
  assert.match(hold.receipt, /remains open by your choice/i);
  // The gate is already clear, so nothing may suggest the choice is still gated.
  assert.doesNotMatch(hold.receipt, /until|stays unavailable|waiting/i);
});

test("only check-ins that touch a gate invalidate a user plan choice", () => {
  const arbitrary = record("ci_note", "The afternoon felt different");
  const pain = record("ci_pain", "My shoulder hurts");

  assert.equal(checkinTouchesPlanGate(arbitrary), false);
  assert.equal(checkinTouchesPlanGate(pain), true);
});

test("an explicit pause survives a later caution check", () => {
  const initial = deriveDayState([]);
  const paused = chooseTrainingForState(initial, null, "pause");
  const fatigue = record("ci_fatigue", "I feel flat");
  const manualChoice = manualChoiceAfterGateChange(paused.manualChoice);

  assert.equal(manualChoice, "pause");
  assert.deepEqual(selectionForState(deriveDayState([fatigue]), manualChoice), {
    choice: "pause",
    source: "user",
  });
});

test("an explicit pause survives a block and reappears after its correction", () => {
  const paused = chooseTrainingForState(deriveDayState([]), null, "pause");
  const pain = record("ci_pain", "My shoulder hurts");
  let manualChoice = manualChoiceAfterGateChange(paused.manualChoice);

  assert.deepEqual(selectionForState(deriveDayState([pain]), manualChoice), {
    choice: "pause",
    source: "gate",
  });

  const correctionResponse = evaluateSyntheticCheckin("Correction: that was wrong", {
    currentState: deriveDayState([]),
    correctedRecord: pain,
  });
  const correction: CheckinRecord = {
    id: "ci_pain_correction",
    time: "12:18 PM",
    originalInput: "Correction: that was wrong",
    modality: "text",
    correctionOf: pain.id,
    response: correctionResponse,
  };
  manualChoice = manualChoiceAfterGateChange(manualChoice);

  assert.equal(deriveDayState([pain, correction]).trainingGate, "pending");
  assert.deepEqual(selectionForState(deriveDayState([pain, correction]), manualChoice), {
    choice: "pause",
    source: "user",
  });
});

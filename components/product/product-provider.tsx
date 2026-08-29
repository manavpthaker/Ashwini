"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { CheckinRecord, DerivedDayState, TrainingChoice } from "@/lib/product-model";
import {
  checkinTouchesPlanGate,
  chooseTrainingForState,
  deriveDayState,
  evaluateSyntheticCheckin,
  manualChoiceAfterGateChange,
  selectionForState,
} from "@/lib/synthetic-scenario";

interface ProductContextValue {
  checkins: readonly CheckinRecord[];
  derivedDay: DerivedDayState;
  selectedTrainingChoice: TrainingChoice;
  trainingChoiceSource: "rule" | "user" | "gate";
  planReceipt: string;
  submitCheckin: (input: string, correctionOf?: string) => CheckinRecord;
  undoLastCheckin: () => void;
  chooseTraining: (choice: TrainingChoice) => void;
}

const ProductContext = createContext<ProductContextValue | null>(null);

function newId(prefix: string) {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${random}`;
}

export function ProductProvider({ children }: { children: ReactNode }) {
  const [checkins, setCheckins] = useState<CheckinRecord[]>([]);
  const [manualTrainingChoice, setManualTrainingChoice] = useState<TrainingChoice | null>(null);
  const [planReceipt, setPlanReceipt] = useState("");
  const derivedDay = useMemo(() => deriveDayState(checkins), [checkins]);
  const trainingSelection = selectionForState(derivedDay, manualTrainingChoice);
  const selectedTrainingChoice = trainingSelection.choice;
  const trainingChoiceSource = trainingSelection.source;

  const submitCheckin = (input: string, correctionOf?: string) => {
    const correctedRecord = correctionOf ? checkins.find((record) => record.id === correctionOf) : undefined;
    if (correctionOf && !correctedRecord) {
      throw new Error("The correction target is no longer available.");
    }
    const evaluationState = correctedRecord
      ? deriveDayState(checkins, [correctedRecord.id])
      : derivedDay;
    const response = evaluateSyntheticCheckin(input, { currentState: evaluationState, correctedRecord });
    const record: CheckinRecord = {
      id: newId("ci"),
      time: response.effects.scenarioPhase === "pre-session" || derivedDay.scenarioPhase === "pre-session"
        ? "3:45 PM"
        : "12:18 PM",
      originalInput: input.trim(),
      modality: "text",
      correctionOf,
      response,
    };

    setCheckins((current) => [...current, record]);
    if (checkinTouchesPlanGate(record, correctedRecord)) {
      setManualTrainingChoice((current) => manualChoiceAfterGateChange(current));
    }
    setPlanReceipt("");
    return record;
  };

  const undoLastCheckin = () => {
    const removedRecord = checkins.at(-1);
    const correctedRecord = removedRecord?.correctionOf
      ? checkins.find((record) => record.id === removedRecord.correctionOf)
      : undefined;
    setCheckins((current) => current.slice(0, -1));
    if (removedRecord && checkinTouchesPlanGate(removedRecord, correctedRecord)) {
      setManualTrainingChoice((current) => manualChoiceAfterGateChange(current));
    }
    setPlanReceipt("");
  };

  const chooseTraining = (choice: TrainingChoice) => {
    const result = chooseTrainingForState(derivedDay, manualTrainingChoice, choice);
    setManualTrainingChoice(result.manualChoice);
    setPlanReceipt(result.receipt);
  };

  const value: ProductContextValue = {
    checkins,
    derivedDay,
    selectedTrainingChoice,
    trainingChoiceSource,
    planReceipt,
    submitCheckin,
    undoLastCheckin,
    chooseTraining,
  };

  return <ProductContext.Provider value={value}>{children}</ProductContext.Provider>;
}

export function useProduct() {
  const value = useContext(ProductContext);
  if (!value) throw new Error("useProduct must be used within ProductProvider.");
  return value;
}

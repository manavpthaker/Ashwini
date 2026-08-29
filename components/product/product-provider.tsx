"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { CheckinRecord, DerivedDayState, TrainingChoice } from "@/lib/product-model";
import { toCheckinResponse } from "@/lib/checkin-adapter";
import { fetchHistory, postCheckin, type HistoricTurn, type SubmittedTurn } from "@/lib/checkin-client";
import {
  checkinTouchesPlanGate,
  chooseTrainingForState,
  deriveDayState,
  manualChoiceAfterGateChange,
  selectionForState,
} from "@/lib/synthetic-scenario";

/**
 * Check-in state, held by the API rather than by this component.
 *
 * The screens were built against `lib/synthetic-scenario.ts`, which decides what
 * a check-in means by matching declared demo phrases against an exact-string
 * Set. Everything the user actually types now goes to `POST /api/conversation`,
 * where the rule pipeline in `domain/advisor` classifies it and the record is
 * written to Postgres. What survives from the synthetic module is the part that
 * was never about interpretation: `deriveDayState` reducing a list of records
 * into the day's state, and the absorbing-block rules that keep a safety route-
 * out visible until it is corrected (PRD 4.4). Those now reduce over effects the
 * server established.
 */

interface ProductContextValue {
  checkins: readonly CheckinRecord[];
  derivedDay: DerivedDayState;
  selectedTrainingChoice: TrainingChoice;
  trainingChoiceSource: "rule" | "user" | "gate";
  planReceipt: string;
  /** Rejects rather than throws: the write is a round trip now. */
  submitCheckin: (input: string, correctionOf?: string) => Promise<CheckinRecord>;
  chooseTraining: (choice: TrainingChoice) => void;
  /** True while the first history load is in flight. */
  loading: boolean;
  submitting: boolean;
  /** Set when the API could not be reached or refused the write. */
  error: string | null;
}

const ProductContext = createContext<ProductContextValue | null>(null);

const timeFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

function displayTime(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : timeFormat.format(at);
}

function toRecord(turn: SubmittedTurn | HistoricTurn, input: string, correctionOf?: string): CheckinRecord {
  return {
    id: turn.userMessageId,
    time: displayTime(turn.ts),
    originalInput: input.trim(),
    modality: "text",
    ...(correctionOf ? { correctionOf } : {}),
    response: toCheckinResponse(turn),
  };
}

export function ProductProvider({ children }: { children: ReactNode }) {
  const [checkins, setCheckins] = useState<readonly CheckinRecord[]>([]);
  const [manualTrainingChoice, setManualTrainingChoice] = useState<TrainingChoice | null>(null);
  const [planReceipt, setPlanReceipt] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const derivedDay = useMemo(() => deriveDayState(checkins), [checkins]);
  const trainingSelection = selectionForState(derivedDay, manualTrainingChoice);

  useEffect(() => {
    const controller = new AbortController();

    fetchHistory({ signal: controller.signal })
      .then((turns) => {
        setCheckins(
          turns.map((turn) =>
            toRecord(
              turn,
              turn.text,
              // The stored link points from the corrected message forward. The
              // screens read it the other way round, so it is inverted here.
              turns.find((other) => other.correctedBy === turn.userMessageId)?.userMessageId,
            ),
          ),
        );
        setError(null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        // PRD 6 of the offline rules: an unreachable record reads as unknown,
        // never as an empty day. The screens show the error rather than a
        // confident "nothing recorded yet".
        setError(cause instanceof Error ? cause.message : "Could not reach the record.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, []);

  const submitCheckin = useCallback(
    async (input: string, correctionOf?: string) => {
      setSubmitting(true);
      try {
        const turn = await postCheckin(input, correctionOf ? { correctionOf } : {});
        const record = toRecord(turn, input, correctionOf);
        const correctedRecord = correctionOf
          ? checkins.find((existing) => existing.id === correctionOf)
          : undefined;

        setCheckins((current) => [...current, record]);
        if (checkinTouchesPlanGate(record, correctedRecord)) {
          setManualTrainingChoice((current) => manualChoiceAfterGateChange(current));
        }
        setPlanReceipt("");
        setError(null);
        return record;
      } catch (cause: unknown) {
        const message = cause instanceof Error ? cause.message : "The check-in was not recorded.";
        setError(message);
        throw cause;
      } finally {
        setSubmitting(false);
      }
    },
    [checkins],
  );

  const chooseTraining = useCallback(
    (choice: TrainingChoice) => {
      const result = chooseTrainingForState(derivedDay, manualTrainingChoice, choice);
      setManualTrainingChoice(result.manualChoice);
      setPlanReceipt(result.receipt);
    },
    [derivedDay, manualTrainingChoice],
  );

  const value: ProductContextValue = {
    checkins,
    derivedDay,
    selectedTrainingChoice: trainingSelection.choice,
    trainingChoiceSource: trainingSelection.source,
    planReceipt,
    submitCheckin,
    chooseTraining,
    loading,
    submitting,
    error,
  };

  return <ProductContext.Provider value={value}>{children}</ProductContext.Provider>;
}

export function useProduct() {
  const value = useContext(ProductContext);
  if (!value) throw new Error("useProduct must be used within ProductProvider.");
  return value;
}

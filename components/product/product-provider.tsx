"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CheckinRecord } from "@/lib/product-model";
import { toCheckinResponse } from "@/lib/checkin-adapter";
import {
  ConversationError,
  createRetrySafeCheckinWriter,
  fetchHistory,
  type HistoricTurn,
  type SubmittedTurn,
} from "@/lib/checkin-client";
import {
  acknowledgeOpenDecision,
  fetchOpenDecisions,
  RecordApiError,
  respondToOpenDecision,
  type OpenDecision,
} from "@/lib/record-client";

interface ProductContextValue {
  checkins: readonly CheckinRecord[];
  openDecisions: readonly OpenDecision[];
  submitCheckin: (input: string, correctionOf?: string) => Promise<CheckinRecord>;
  respondToDecision: (decisionId: string, choice: string) => Promise<void>;
  acknowledgeDecision: (decisionId: string) => Promise<void>;
  loading: boolean;
  submitting: boolean;
  respondingDecisionId: string | null;
  error: string | null;
  decisionReceipt: { readonly decisionId: string; readonly text: string } | null;
  timeZone: string;
}

const ProductContext = createContext<ProductContextValue | null>(null);

function displayTime(iso: string, timeZone: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone,
      }).format(at);
}

function toRecord(
  turn: SubmittedTurn | HistoricTurn,
  input: string,
  correctionOf?: string,
): CheckinRecord {
  return {
    id: turn.userMessageId,
    recordedAt: turn.ts,
    time: displayTime(turn.ts, turn.timeZone),
    originalInput: displayInput(turn, input),
    modality: "text",
    ...(correctionOf ? { correctionOf } : {}),
    response: toCheckinResponse(turn),
  };
}

function displayInput(turn: SubmittedTurn | HistoricTurn, input: string): string {
  return turn.text.trim() || input.trim();
}

function withRecordedDecisionResponse(
  record: CheckinRecord,
  decisionId: string,
  choice: string,
  respondedAt: string,
): CheckinRecord {
  if (record.response.decision?.id !== decisionId) return record;
  return {
    ...record,
    response: {
      ...record.response,
      decision: {
        ...record.response.decision,
        selectedChoice: choice,
        respondedAt,
      },
    },
  };
}

function recordsFromHistory(
  history: Awaited<ReturnType<typeof fetchHistory>>,
): readonly CheckinRecord[] {
  return history.turns.map((turn) =>
    toRecord(
      turn,
      turn.text,
      history.turns.find((other) => other.correctedBy === turn.userMessageId)?.userMessageId,
    ),
  );
}

export function ProductProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const checkinWriter = useRef<ReturnType<typeof createRetrySafeCheckinWriter> | null>(null);
  if (checkinWriter.current === null) checkinWriter.current = createRetrySafeCheckinWriter();
  const [checkins, setCheckins] = useState<readonly CheckinRecord[]>([]);
  const [openDecisions, setOpenDecisions] = useState<readonly OpenDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [respondingDecisionId, setRespondingDecisionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decisionReceipt, setDecisionReceipt] = useState<{
    readonly decisionId: string;
    readonly text: string;
  } | null>(null);
  const [timeZone, setTimeZone] = useState("UTC");

  const handleFailure = useCallback((cause: unknown, fallback: string) => {
    if (statusOf(cause) === 401) {
      setCheckins([]);
      setOpenDecisions([]);
      router.replace("/login");
      return;
    }
    setError(cause instanceof Error ? cause.message : fallback);
  }, [router]);

  const loadRecordState = useCallback(async (signal?: AbortSignal) => {
    const [history, decisions] = await Promise.all([
      fetchHistory(signal ? { signal } : {}),
      fetchOpenDecisions(signal),
    ]);
    if (signal?.aborted) return;
    setTimeZone(history.timeZone);
    setCheckins(recordsFromHistory(history));
    setOpenDecisions(decisions);
    setError(null);
  }, []);

  const handleMutationFailure = useCallback(
    async (cause: unknown, fallback: string) => {
      const status = statusOf(cause);
      if (status === 401) {
        handleFailure(cause, fallback);
        return;
      }

      // A conflict means another immutable write won. Reconcile both history
      // and open decisions so the UI can show the winning response or
      // correction instead of merely removing a stale control.
      if (status === 409) {
        try {
          await loadRecordState();
        } catch (refreshError) {
          handleFailure(refreshError, "The record changed, but its current state could not be refreshed.");
        }
      }

      // Other mutation failures do not make an already-loaded record
      // unavailable. In particular, uncertain check-in writes retain their
      // idempotency key and remain retryable from the initiating screen.
    },
    [handleFailure, loadRecordState],
  );

  useEffect(() => {
    const controller = new AbortController();

    Promise.all([
      fetchHistory({ signal: controller.signal }),
      fetchOpenDecisions(controller.signal),
    ])
      .then(([history, decisions]) => {
        if (controller.signal.aborted) return;
        setTimeZone(history.timeZone);
        setCheckins(recordsFromHistory(history));
        setOpenDecisions(decisions);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) handleFailure(cause, "Could not reach your record.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [handleFailure]);

  const submitCheckin = useCallback(
    async (input: string, correctionOf?: string) => {
      setSubmitting(true);
      try {
        const turn = await checkinWriter.current!.submit(
          input,
          correctionOf ? { correctionOf } : {},
        );
        const record = toRecord(turn, input, correctionOf);
        setCheckins((current) =>
          current.some((item) => item.id === record.id)
            ? current.map((item) => (item.id === record.id ? record : item))
            : [...current, record],
        );
        setDecisionReceipt(null);
        setError(null);

        try {
          setOpenDecisions(await fetchOpenDecisions());
        } catch (refreshError) {
          handleFailure(
            refreshError,
            "The check-in was recorded, but current decisions could not be refreshed.",
          );
        }

        return record;
      } catch (cause: unknown) {
        await handleMutationFailure(cause, "The check-in was not recorded.");
        throw cause;
      } finally {
        setSubmitting(false);
      }
    },
    [handleFailure, handleMutationFailure],
  );

  const respondToDecision = useCallback(
    async (decisionId: string, choice: string) => {
      setRespondingDecisionId(decisionId);
      setDecisionReceipt(null);
      try {
        const recorded = await respondToOpenDecision(decisionId, choice);
        setCheckins((current) =>
          current.map((record) =>
            withRecordedDecisionResponse(record, decisionId, choice, recorded.respondedAt),
          ),
        );
        setOpenDecisions((current) =>
          current.filter((decision) => decision.decisionId !== decisionId),
        );
        setDecisionReceipt({
          decisionId,
          text: `Recorded · ${choice}`,
        });
        setError(null);

        try {
          setOpenDecisions(await fetchOpenDecisions());
        } catch (refreshError) {
          handleFailure(
            refreshError,
            "Your response was recorded, but current decisions could not be refreshed.",
          );
        }
      } catch (cause: unknown) {
        await handleMutationFailure(cause, "The response was not recorded.");
        throw cause;
      } finally {
        setRespondingDecisionId(null);
      }
    },
    [handleFailure, handleMutationFailure],
  );

  const acknowledgeDecision = useCallback(
    async (decisionId: string) => {
      setRespondingDecisionId(decisionId);
      setDecisionReceipt(null);
      try {
        const recorded = await acknowledgeOpenDecision(decisionId);
        setCheckins((current) =>
          current.map((record) =>
            withRecordedDecisionResponse(
              record,
              decisionId,
              "Acknowledged",
              recorded.respondedAt,
            ),
          ),
        );
        setOpenDecisions((current) =>
          current.filter((decision) => decision.decisionId !== decisionId),
        );
        setDecisionReceipt({
          decisionId,
          text: "Acknowledged · this prompt is closed; the underlying concern is not marked resolved.",
        });
        setError(null);

        try {
          setOpenDecisions(await fetchOpenDecisions());
        } catch (refreshError) {
          handleFailure(
            refreshError,
            "The acknowledgment was recorded, but current decisions could not be refreshed.",
          );
        }
      } catch (cause: unknown) {
        await handleMutationFailure(cause, "The acknowledgment was not recorded.");
        throw cause;
      } finally {
        setRespondingDecisionId(null);
      }
    },
    [handleFailure, handleMutationFailure],
  );

  useEffect(() => {
    const expirations = openDecisions
      .map((decision) => (decision.expiresAt ? new Date(decision.expiresAt).getTime() : NaN))
      .filter((value) => Number.isFinite(value) && value > Date.now());
    if (expirations.length === 0) return;

    const nextExpiry = Math.min(...expirations);
    const delay = Math.min(Math.max(nextExpiry - Date.now() + 100, 0), 2_147_000_000);
    const timer = window.setTimeout(() => {
      setOpenDecisions((current) =>
        current.filter(
          (decision) => !decision.expiresAt || new Date(decision.expiresAt).getTime() > Date.now(),
        ),
      );
      void fetchOpenDecisions()
        .then((decisions) => {
          setOpenDecisions(decisions);
          setError(null);
        })
        .catch((cause: unknown) =>
          handleFailure(cause, "Current decisions could not be refreshed after expiry."),
        );
    }, delay);

    return () => window.clearTimeout(timer);
  }, [handleFailure, openDecisions]);

  return (
    <ProductContext.Provider
      value={{
        checkins,
        openDecisions,
        submitCheckin,
        respondToDecision,
        acknowledgeDecision,
        loading,
        submitting,
        respondingDecisionId,
        error,
        decisionReceipt,
        timeZone,
      }}
    >
      {children}
    </ProductContext.Provider>
  );
}

function statusOf(cause: unknown): number | null {
  if (cause instanceof ConversationError || cause instanceof RecordApiError) return cause.status;
  return null;
}

export function useProduct() {
  const value = useContext(ProductContext);
  if (!value) throw new Error("useProduct must be used within ProductProvider.");
  return value;
}

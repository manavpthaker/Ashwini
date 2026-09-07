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
  historyLoading: boolean;
  decisionsLoading: boolean;
  historyError: string | null;
  decisionsError: string | null;
  reloadRecords: () => Promise<void>;
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
  const [historyLoading, setHistoryLoading] = useState(true);
  const [decisionsLoading, setDecisionsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [respondingDecisionId, setRespondingDecisionId] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [decisionsError, setDecisionsError] = useState<string | null>(null);
  const historyEpoch = useRef(0);
  const decisionsEpoch = useRef(0);
  const mutationEpoch = useRef(0);
  const [decisionReceipt, setDecisionReceipt] = useState<{
    readonly decisionId: string;
    readonly text: string;
  } | null>(null);
  const [timeZone, setTimeZone] = useState("UTC");

  const handleFailure = useCallback((cause: unknown, fallback: string) => {
    if (statusOf(cause) === 401) {
      historyEpoch.current += 1;
      decisionsEpoch.current += 1;
      setCheckins([]);
      setOpenDecisions([]);
      setHistoryLoading(false);
      setDecisionsLoading(false);
      router.replace("/login");
      return;
    }
    setDecisionsError(cause instanceof Error ? cause.message : fallback);
  }, [router]);

  const loadHistory = useCallback(async (signal?: AbortSignal) => {
    const epoch = ++historyEpoch.current;
    const mutations = mutationEpoch.current;
    setHistoryLoading(true);
    try {
      const history = await fetchHistory({ signal: readDeadline(signal) });
      if (signal?.aborted || epoch !== historyEpoch.current) return;
      setTimeZone(history.timeZone);
      const records = recordsFromHistory(history);
      setCheckins((current) => mutations === mutationEpoch.current ? records : mergeRecords(records, current));
      setHistoryError(null);
    } catch (cause) {
      if (signal?.aborted || epoch !== historyEpoch.current) return;
      if (statusOf(cause) === 401) handleFailure(cause, "Not signed in.");
      else setHistoryError("Recent check-ins could not be refreshed. Saved responses remain visible; retry the history read.");
    } finally {
      if (!signal?.aborted && epoch === historyEpoch.current) setHistoryLoading(false);
    }
  }, [handleFailure]);

  const loadDecisions = useCallback(async (signal?: AbortSignal) => {
    const epoch = ++decisionsEpoch.current;
    setDecisionsLoading(true);
    try {
      const decisions = await fetchOpenDecisions(readDeadline(signal));
      if (signal?.aborted || epoch !== decisionsEpoch.current) return;
      setOpenDecisions(decisions);
      setDecisionsError(null);
    } catch (cause) {
      if (!signal?.aborted && epoch === decisionsEpoch.current) {
        handleFailure(cause, "Current decisions could not be refreshed.");
      }
    } finally {
      if (!signal?.aborted && epoch === decisionsEpoch.current) setDecisionsLoading(false);
    }
  }, [handleFailure]);

  const loadRecordState = useCallback(async (signal?: AbortSignal) => {
    await Promise.all([loadHistory(signal), loadDecisions(signal)]);
  }, [loadHistory, loadDecisions]);

  const reloadRecords = useCallback(() => loadRecordState(), [loadRecordState]);

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

    queueMicrotask(() => {
      if (!controller.signal.aborted) void loadRecordState(controller.signal);
    });

    return () => controller.abort();
  }, [loadRecordState]);

  const submitCheckin = useCallback(
    async (input: string, correctionOf?: string) => {
      setSubmitting(true);
      try {
        const turn = await checkinWriter.current!.submit(
          input,
          correctionOf ? { correctionOf } : {},
        );
        const record = toRecord(turn, input, correctionOf);
        mutationEpoch.current += 1;
        setTimeZone(turn.timeZone);
        setCheckins((current) =>
          current.some((item) => item.id === record.id)
            ? current.map((item) => (item.id === record.id ? record : item))
            : [...current, record],
        );
        setDecisionReceipt(null);
        // A saved response is useful immediately. A secondary read must not
        // keep the composer pending or hide that response when it fails.
        void loadDecisions();

        return record;
      } catch (cause: unknown) {
        await handleMutationFailure(cause, "The check-in was not recorded.");
        throw cause;
      } finally {
        setSubmitting(false);
      }
    },
    [loadDecisions, handleMutationFailure],
  );

  const respondToDecision = useCallback(
    async (decisionId: string, choice: string) => {
      setRespondingDecisionId(decisionId);
      setDecisionReceipt(null);
      try {
        const recorded = await respondToOpenDecision(decisionId, choice);
        mutationEpoch.current += 1;
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
        void loadDecisions();
      } catch (cause: unknown) {
        await handleMutationFailure(cause, "The response was not recorded.");
        throw cause;
      } finally {
        setRespondingDecisionId(null);
      }
    },
    [loadDecisions, handleMutationFailure],
  );

  const acknowledgeDecision = useCallback(
    async (decisionId: string) => {
      setRespondingDecisionId(decisionId);
      setDecisionReceipt(null);
      try {
        const recorded = await acknowledgeOpenDecision(decisionId);
        mutationEpoch.current += 1;
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
        void loadDecisions();
      } catch (cause: unknown) {
        await handleMutationFailure(cause, "The acknowledgment was not recorded.");
        throw cause;
      } finally {
        setRespondingDecisionId(null);
      }
    },
    [loadDecisions, handleMutationFailure],
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
      void loadDecisions();
    }, delay);

    return () => window.clearTimeout(timer);
  }, [loadDecisions, openDecisions]);

  return (
    <ProductContext.Provider
      value={{
        checkins,
        openDecisions,
        submitCheckin,
        respondToDecision,
        acknowledgeDecision,
        loading: historyLoading || decisionsLoading,
        historyLoading,
        decisionsLoading,
        historyError,
        decisionsError,
        reloadRecords,
        submitting,
        respondingDecisionId,
        error: historyError ?? decisionsError,
        decisionReceipt,
        timeZone,
      }}
    >
      {children}
    </ProductContext.Provider>
  );
}

/** Preserve a just-saved POST result when an older history read finishes late. */
export function mergeRecords(history: readonly CheckinRecord[], current: readonly CheckinRecord[]): readonly CheckinRecord[] {
  const records = new Map(history.map((record) => [record.id, record]));
  for (const record of current) records.set(record.id, record);
  return [...records.values()].sort((left, right) => (left.recordedAt ?? "").localeCompare(right.recordedAt ?? ""));
}

function readDeadline(signal?: AbortSignal): AbortSignal {
  const deadline = AbortSignal.timeout(15_000);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
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

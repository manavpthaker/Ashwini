import type { DecisionType, RouteDestination } from "@/domain/advisor/types";
import type { Domain } from "@/domain/domains";
import type { EvidenceStatus, GateOutcome, LadderLevel } from "@/domain/evidence";

export interface OpenDecision {
  readonly decisionId: string;
  readonly createdAt: string;
  readonly type: DecisionType;
  readonly domain: Domain;
  readonly evidenceStatus: EvidenceStatus;
  readonly ladderLevel: LadderLevel;
  readonly confidenceNote: string;
  readonly gateOutcome: GateOutcome;
  readonly gateReason: string;
  readonly target: string | null;
  readonly expectedLag: string | null;
  readonly choices: readonly string[];
  readonly refused: string;
  readonly expiresAt: string | null;
  readonly route: RouteDestination | null;
  readonly ruleId: string;
  readonly advisorVersion: string;
  readonly reply: { readonly text: string; readonly receipt: string };
  readonly sourceMessageId: string | null;
}

export interface TodaySnapshot {
  readonly day: string;
  readonly timeZone: string;
  readonly generatedAt: string;
  readonly partOfDay: "early-morning" | "morning" | "midday" | "afternoon" | "evening" | "night";
  readonly commitments: readonly {
    id: string;
    startsAt: string;
    endsAt: string | null;
    domain: Domain;
    title: string;
    detail: string | null;
    kind: "training" | "meal" | "dose" | "review" | "capture" | "other";
    decisionId: string | null;
  }[];
  readonly doses: readonly {
    id: string;
    scheduledAt: string | null;
    takenAt: string | null;
    skipped: boolean;
    skipReason: string | null;
    note: string | null;
    medication: { id: string; name: string };
  }[];
  readonly meals: readonly {
    id: string;
    at: string;
    kind: "breakfast" | "lunch" | "dinner" | "snack" | null;
    description: string | null;
    source: "text" | "photo" | "reference" | "recipe";
    confidence: "low" | "medium" | "high";
    kcalRange: { low: number | string; high: number | string } | null;
    proteinRange: { low: number | string; high: number | string } | null;
    messageId: string | null;
  }[];
  readonly trainingSessions: readonly {
    id: string;
    at: string;
    planned: boolean;
    completed: boolean;
    kind: string | null;
    volumeNote: string | null;
    perceivedEffort: number | null;
    notes: string | null;
    commitmentId: string | null;
  }[];
}

export type RoutineStatus = "candidate" | "active" | "paused" | "concluded" | "retired";

export interface RoutineReview {
  readonly id: string;
  readonly routineId: string;
  readonly reviewedAt: string;
  readonly evidenceStatus: EvidenceStatus;
  readonly withCount: number;
  readonly withoutCount: number;
  readonly excludedCount: number;
  readonly summary: string;
  readonly refused: string;
  readonly decisionId: string | null;
}

export interface PlanSnapshot {
  readonly timeZone: string;
  readonly routines: readonly {
    id: string;
    name: string;
    domain: Domain;
    status: RoutineStatus;
    behavior: string;
    target: string;
    expectedLag: string;
    reviewAt: string | null;
    confoundIds: readonly string[];
    stopBoundary: string | null;
    comparator: string | null;
    interpretationThreshold: string | null;
    minimumComparable: number;
    eligibleWhen: string | null;
    startedOn: string | null;
    progress: { total: number; performed: number; comparable: number; excluded: number };
    latestOccurrence: {
      id: string;
      at: string;
      performed: boolean;
      comparable: boolean;
      exclusionReason: string | null;
      gateOutcome: GateOutcome | null;
    } | null;
    latestReview: RoutineReview | null;
  }[];
  readonly reviews: readonly RoutineReview[];
}

export class RecordApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RecordApiError";
  }
}

export async function fetchOpenDecisions(signal?: AbortSignal): Promise<readonly OpenDecision[]> {
  const response = await fetch("/api/decisions?limit=100", signal ? { signal } : undefined);
  if (!response.ok) await readError(response);
  const body = (await response.json()) as { decisions: readonly OpenDecision[] };
  return body.decisions;
}

export interface RecordedDecisionResponse {
  readonly responseId: string;
  readonly respondedAt: string;
}

export async function respondToOpenDecision(
  decisionId: string,
  choice: string,
): Promise<RecordedDecisionResponse> {
  const response = await fetch(`/api/decisions/${encodeURIComponent(decisionId)}/respond`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ choice }),
  });
  if (!response.ok) await readError(response);
  return (await response.json()) as RecordedDecisionResponse;
}

export async function acknowledgeOpenDecision(
  decisionId: string,
): Promise<RecordedDecisionResponse> {
  const response = await fetch(`/api/decisions/${encodeURIComponent(decisionId)}/respond`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ acknowledge: true }),
  });
  if (!response.ok) await readError(response);
  return (await response.json()) as RecordedDecisionResponse;
}

export async function fetchTodaySnapshot(signal?: AbortSignal): Promise<TodaySnapshot> {
  return readSnapshot<TodaySnapshot>("/api/today", signal);
}

export async function fetchPlanSnapshot(signal?: AbortSignal): Promise<PlanSnapshot> {
  return readSnapshot<PlanSnapshot>("/api/plan", signal);
}

async function readSnapshot<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, signal ? { signal } : undefined);
  if (!response.ok) await readError(response);
  return (await response.json()) as T;
}

async function readError(response: Response): Promise<never> {
  let detail = `The record returned ${response.status}.`;
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "error" in body) {
      const error = body.error;
      if (typeof error === "string") detail = error;
      else if (
        error &&
        typeof error === "object" &&
        "message" in error &&
        typeof error.message === "string"
      ) {
        detail = error.message;
      }
    }
  } catch {
    // The status remains authoritative when an upstream response is not JSON.
  }
  throw new RecordApiError(detail, response.status);
}

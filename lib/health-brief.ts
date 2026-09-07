import type { HealthHistoryEntry } from "@/domain/advisor/types";

export interface BriefCoverage {
  type: string;
  label: string;
  latestEndAt: string | null;
  freshness: "recent" | "historical" | "missing";
  windowTruncated: boolean;
}

export interface HealthBrief {
  available: boolean;
  generatedAt: string;
  timeZone: string;
  headline: string;
  summary: string;
  nextStep: string;
  context: readonly Pick<
    HealthHistoryEntry,
    "id" | "statement" | "sourceLabel" | "sourceDate" | "sourceDatePrecision" | "temporalStatus"
  >[];
  coverage: readonly BriefCoverage[];
  limitation: string;
}

/** A local orientation, not a new clinical verdict, model response or dose plan. */
export function composeHealthBrief(input: {
  history: readonly HealthHistoryEntry[];
  coverage: readonly BriefCoverage[];
  generatedAt: string;
  timeZone?: string;
}): HealthBrief {
  const history = [...input.history].sort(
    (left, right) =>
      (right.sourceDate ?? "").localeCompare(left.sourceDate ?? "") ||
      left.id.localeCompare(right.id),
  );
  const trainingGoalEntry = history.find(
    (entry) =>
      entry.category === "goal" &&
      /training|strength|muscle|fat loss|body composition/i.test(entry.statement),
  );
  const selected = [
    trainingGoalEntry ?? history.find((entry) => entry.category === "goal"),
    history.find((entry) => entry.category === "preference"),
  ].filter((entry): entry is HealthHistoryEntry => Boolean(entry));
  const requested = [
    "HKCategoryTypeIdentifierSleepAnalysis",
    "HKQuantityTypeIdentifierHeartRate",
    "HKQuantityTypeIdentifierBodyMass",
    "HKQuantityTypeIdentifierStepCount",
  ];
  const coverage = requested.flatMap((type) => {
    const item = input.coverage.find((entry) => entry.type === type);
    return item ? [item] : [];
  });
  const hasObservations = input.coverage.some((entry) => entry.latestEndAt !== null);
  const available = history.length > 0 || hasObservations;
  const sleep = input.coverage.find(
    (entry) => entry.type === "HKCategoryTypeIdentifierSleepAnalysis",
  );
  const recoveryNeedsUpdate = sleep?.freshness !== "recent";
  const trainingGoal = Boolean(trainingGoalEntry);
  return {
    available,
    generatedAt: input.generatedAt,
    timeZone: input.timeZone ?? "UTC",
    headline: !available
      ? "Start with the context you already have."
      : trainingGoal
        ? "Keep recovery alongside your training goal."
        : "Start from your history, then add today.",
    summary: !available
      ? "There is no imported health context yet. A short check-in or a prepared history import gives Ashwini a place to begin."
      : recoveryNeedsUpdate
        ? "Your saved history gives this check-in a starting point. The recovery picture is older or incomplete, so it cannot tell us how you slept last night or how ready you feel today."
        : "Recent sleep records are available alongside your saved history. They can inform a recovery check-in, but recorded sleep alone cannot establish how rested you feel or explain a symptom.",
    nextStep: !available
      ? "Share the decision you need help with, or import your existing health context."
      : trainingGoal
        ? "Before increasing training effort, compare today's energy with your usual routine. If you feel under-recovered, keep optional effort easy and include last night's sleep in your check-in."
        : "Use the next check-in to connect one current concern with this history: what changed, when it started and what you want to decide. You do not need to repeat the full record.",
    context: selected.map(
      ({ id, statement, sourceLabel, sourceDate, sourceDatePrecision, temporalStatus }) => ({
        id,
        statement,
        sourceLabel,
        sourceDate,
        sourceDatePrecision,
        temporalStatus,
      }),
    ),
    coverage,
    limitation:
      "Source-backed local brief, not a clinical assessment. Imported history is a dated snapshot; it does not confirm current medications, adherence or live monitoring.",
  };
}

export async function fetchHealthBrief(signal?: AbortSignal): Promise<HealthBrief> {
  const deadline = AbortSignal.timeout(15_000);
  const response = await fetch("/api/health-brief", {
    cache: "no-store",
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
  });
  if (!response.ok) throw new Error("Your health brief could not be refreshed. Try again.");
  return response.json() as Promise<HealthBrief>;
}

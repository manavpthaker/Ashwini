import { db } from "@/server/db/client";
import { currentPrincipal } from "@/server/auth";
import { sql } from "kysely";
import { env } from "@/server/env";

export const dynamic = "force-dynamic";

/** Live routines and evidence reviews. Decisions stay on `/api/decisions`. */
export async function GET(request: Request): Promise<Response> {
  if (!(await currentPrincipal(request))) return unauthorized();

  try {
    const kysely = db();
    const routines = await kysely
      .selectFrom("ashwini.routines")
      .select([
        "routine_id",
        "name",
        "domain",
        "status",
        "behavior",
        "target",
        "expected_lag",
        "review_at",
        "confound_ids",
        "stop_boundary",
        "comparator",
        "interpretation_threshold",
        "min_comparable_n",
        "eligible_when",
        "started_on",
      ])
      .where("status", "in", ["candidate", "active", "paused"])
      .orderBy("review_at", "asc")
      .orderBy("name", "asc")
      .execute();

    const routineIds = routines.map((routine) => routine.routine_id);
    const [occurrenceCounts, latestOccurrences, latestReviews] = routineIds.length
      ? await Promise.all([
          kysely
            .selectFrom("ashwini.routine_occurrences")
            .select([
              "routine_id",
              sql<number>`count(*)::int`.as("total"),
              sql<number>`count(*) filter (where performed)::int`.as("performed"),
              sql<number>`count(*) filter (where comparable)::int`.as("comparable"),
              sql<number>`count(*) filter (where not comparable)::int`.as("excluded"),
            ])
            .where("routine_id", "in", routineIds)
            .groupBy("routine_id")
            .execute(),
          kysely
            .selectFrom("ashwini.routine_occurrences")
            .select([
              "occurrence_id",
              "routine_id",
              "ts",
              "performed",
              "comparable",
              "exclusion_reason",
              "gate_outcome",
            ])
            .distinctOn("routine_id")
            .where("routine_id", "in", routineIds)
            .orderBy("routine_id", "asc")
            .orderBy("ts", "desc")
            .orderBy("occurrence_id", "desc")
            .execute(),
          kysely
            .selectFrom("ashwini.routine_reviews")
            .select([
              "review_id",
              "routine_id",
              "reviewed_ts",
              "evidence_status",
              "n_with",
              "n_without",
              "n_excluded",
              "summary",
              "refused",
              "decision_id",
            ])
            .distinctOn("routine_id")
            .where("routine_id", "in", routineIds)
            .orderBy("routine_id", "asc")
            .orderBy("reviewed_ts", "desc")
            .orderBy("review_id", "desc")
            .execute(),
        ])
      : [[], [], []] as const;

    const countsByRoutine = new Map(occurrenceCounts.map((row) => [row.routine_id, row]));
    const occurrenceByRoutine = new Map(latestOccurrences.map((row) => [row.routine_id, row]));
    const reviewByRoutine = new Map(latestReviews.map((row) => [row.routine_id, row]));
    const reviewsByRecency = [...latestReviews].sort(
      (left, right) => right.reviewed_ts.getTime() - left.reviewed_ts.getTime(),
    );

    return Response.json(
      {
        timeZone: env().ASHWINI_TIME_ZONE,
        routines: routines.map((routine) => {
          const counts = countsByRoutine.get(routine.routine_id);
          const latestOccurrence = occurrenceByRoutine.get(routine.routine_id);
          const latestReview = reviewByRoutine.get(routine.routine_id);
          return {
            id: routine.routine_id,
            name: routine.name,
            domain: routine.domain,
            status: routine.status,
            behavior: routine.behavior,
            target: routine.target,
            expectedLag: routine.expected_lag,
            reviewAt: routine.review_at?.toISOString() ?? null,
            confoundIds: routine.confound_ids,
            stopBoundary: routine.stop_boundary,
            comparator: routine.comparator,
            interpretationThreshold: routine.interpretation_threshold,
            minimumComparable: routine.min_comparable_n,
            eligibleWhen: routine.eligible_when,
            startedOn: routine.started_on,
            progress: {
              total: counts?.total ?? 0,
              performed: counts?.performed ?? 0,
              comparable: counts?.comparable ?? 0,
              excluded: counts?.excluded ?? 0,
            },
            latestOccurrence: latestOccurrence
              ? {
                  id: latestOccurrence.occurrence_id,
                  at: latestOccurrence.ts.toISOString(),
                  performed: latestOccurrence.performed,
                  comparable: latestOccurrence.comparable,
                  exclusionReason: latestOccurrence.exclusion_reason,
                  gateOutcome: latestOccurrence.gate_outcome,
                }
              : null,
            latestReview: latestReview
              ? {
                  id: latestReview.review_id,
                  routineId: latestReview.routine_id,
                  reviewedAt: latestReview.reviewed_ts.toISOString(),
                  evidenceStatus: latestReview.evidence_status,
                  withCount: latestReview.n_with,
                  withoutCount: latestReview.n_without,
                  excludedCount: latestReview.n_excluded,
                  summary: latestReview.summary,
                  refused: latestReview.refused,
                  decisionId: latestReview.decision_id,
                }
              : null,
          };
        }),
        reviews: reviewsByRecency.map((review) => ({
          id: review.review_id,
          routineId: review.routine_id,
          reviewedAt: review.reviewed_ts.toISOString(),
          evidenceStatus: review.evidence_status,
          withCount: review.n_with,
          withoutCount: review.n_without,
          excludedCount: review.n_excluded,
          summary: review.summary,
          refused: review.refused,
          decisionId: review.decision_id,
        })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("Plan record query failed", error);
    return problem(503, "PLAN_UNAVAILABLE", "Plan records are temporarily unavailable.");
  }
}

function unauthorized(): Response {
  return problem(401, "NOT_SIGNED_IN", "Not signed in.");
}

function problem(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

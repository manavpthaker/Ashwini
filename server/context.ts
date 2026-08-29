import "server-only";
import type { Clock } from "@/domain/clock";
import { localDay } from "@/domain/clock";
import type { Domain } from "@/domain/domains";
import type { ConfoundDefinition, ConfoundEvaluation } from "@/domain/gate";
import type { SubjectContext } from "@/domain/advisor";
import { db } from "./db/client";

/**
 * Materialise everything the advisor is allowed to reason from.
 *
 * The advisor never fetches — that is what keeps the whole safety layer
 * testable without a database, and what stops a rule quietly reaching for a
 * fact nobody declared. Every read the rules need happens here, once.
 */
export async function buildSubjectContext(clock: Clock): Promise<SubjectContext> {
  const now = clock.now();
  const day = localDay(clock, now);
  const kysely = db();

  const [
    medications,
    supplements,
    interactionResults,
    definitions,
    evaluations,
    meals,
    commitments,
  ] = await Promise.all([
    kysely
      .selectFrom("ashwini.medications")
      .select(["name"])
      .where("stopped_at", "is", null)
      .execute(),

    // What the user actually takes, not what has happened to be checked before.
    kysely
      .selectFrom("ashwini.interventions")
      .select(["name"])
      .where("category", "=", "supplement")
      .where("stopped_at", "is", null)
      .execute(),

    kysely
      .selectFrom("ashwini.external_results")
      .select([
        "provider",
        "items",
        "requested_ts",
        "cache_expires_at",
        "evidence_grade",
        "response",
        "error",
      ])
      .where("error", "is", null)
      .orderBy("requested_ts", "desc")
      .limit(25)
      .execute(),

    kysely
      .selectFrom("ashwini.confound_definitions")
      .selectAll()
      .where("active", "=", true)
      .execute(),

    kysely
      .selectFrom("ashwini.confound_evaluations")
      .select(["confound_id", "state", "detail"])
      .where("subject_kind", "=", "window")
      .where("evaluated_ts", ">=", startOfDay(day))
      .execute(),

    kysely
      .selectFrom("ashwini.meals")
      .select(["kind", "ts"])
      .where("ts", ">=", startOfDay(day))
      .execute(),

    kysely
      .selectFrom("ashwini.commitments")
      .select(["title", "domain", "starts_at"])
      .where("starts_at", ">=", now)
      .orderBy("starts_at", "asc")
      .limit(10)
      .execute(),
  ]);

  return {
    mealsToday: meals
      .filter(
        (meal): meal is { kind: NonNullable<typeof meal.kind>; ts: Date } => meal.kind !== null,
      )
      .map((meal) => ({ kind: meal.kind, at: meal.ts })),

    commitments: commitments.map((commitment) => ({
      title: commitment.title,
      domain: commitment.domain as Domain,
      startsAt: commitment.starts_at,
    })),

    // Routines arrive with PRD 13.5b; the advisor tolerates an empty list.
    activeRoutines: [],

    medications: medications.map((medication) => ({
      name: medication.name,
      aliases: [],
      isPrescription: true,
    })),

    supplements: [...new Set(supplements.map((intervention) => intervention.name))],

    interactionResults: interactionResults.map((result) => ({
      provider: result.provider,
      items: result.items,
      checkedAt: result.requested_ts,
      expiresAt: result.cache_expires_at,
      evidenceGrade: result.evidence_grade,
      summary: summarise(result.response),
    })),

    confoundDefinitions: definitions.map((definition): ConfoundDefinition => ({
      id: definition.confound_id,
      label: definition.label,
      domains: definition.domains,
      blocking: definition.blocking,
      requiredForVerdict: definition.required_for_verdict,
      threshold: (definition.threshold ?? {}) as Record<string, unknown>,
      version: definition.version,
    })),

    confoundEvaluations: evaluations.map((evaluation): ConfoundEvaluation => ({
      confoundId: evaluation.confound_id,
      state: evaluation.state,
      ...(evaluation.detail === null ? {} : { detail: evaluation.detail }),
    })),
  };
}

function startOfDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/**
 * Turn a stored Examine payload into one sentence the advisor can quote.
 *
 * Deliberately conservative: an unreadable payload reads as "no findings
 * recorded", never as "no interaction", because PRD 7.3 forbids treating
 * absence as safety.
 */
function summarise(response: unknown): string {
  if (!response || typeof response !== "object") {
    return "No findings recorded on this check.";
  }
  const data = (response as { data?: unknown }).data;
  if (!Array.isArray(data)) return "No findings recorded on this check.";
  if (data.length === 0) return "No interactions were returned for this combination.";
  return `${data.length} interaction finding${data.length === 1 ? "" : "s"} returned; see the cited references.`;
}

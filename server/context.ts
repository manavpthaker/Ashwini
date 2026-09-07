import "server-only";
import type { Clock } from "@/domain/clock";
import { dayWindow } from "@/domain/clock";
import type { Domain } from "@/domain/domains";
import type { ConfoundDefinition, ConfoundEvaluation } from "@/domain/gate";
import {
  classifySensitiveContent,
  SENSITIVE_REDACTION,
  type SubjectContext,
} from "@/domain/advisor";
import type { HealthHistoryEntry } from "@/domain/advisor/types";
import { sql } from "kysely";
import { db } from "./db/client";
import { buildHealthObservationContext } from "./health-observation-context";

export { buildHealthObservationContext } from "./health-observation-context";

/** Context browsing must not load the raw wearable chart or operational check-in state. */
export async function buildHealthHistory(): Promise<HealthHistoryEntry[]> {
  const kysely = db();
  const entries = await kysely
    .selectFrom("ashwini.health_context_entries as entry")
    .innerJoin(
      kysely
        .selectFrom("ashwini.health_context_sources")
        .select(["source_id", "source_label"])
        .distinctOn("source_key")
        .orderBy("source_key")
        .orderBy("version_seq", "desc")
        .as("source"),
      "source.source_id",
      "entry.source_id",
    )
    .select([
      "entry.context_id",
      "entry.category",
      "entry.statement",
      "source.source_label",
      "entry.source_locator",
      "entry.date_precision",
      "entry.temporal_status",
      "entry.confirmation_required",
      // Preserve the source calendar date, independent of the host timezone.
      sql<string | null>`entry.source_date::text`.as("source_date"),
    ])
    .orderBy("entry.category")
    .orderBy("entry.source_date", "desc")
    .orderBy("entry.context_id")
    .execute();
  return entries.map((entry) => ({
    id: entry.context_id,
    category: entry.category,
    statement: entry.statement,
    sourceLabel: entry.source_label,
    sourceLocator: entry.source_locator,
    sourceDate: entry.source_date,
    sourceDatePrecision: entry.date_precision,
    temporalStatus: entry.temporal_status,
    confirmationRequired: entry.confirmation_required,
  }));
}

/**
 * Materialise everything the advisor is allowed to reason from.
 *
 * The advisor never fetches — that is what keeps the whole safety layer
 * testable without a database, and what stops a rule quietly reaching for a
 * fact nobody declared. Every read the rules need happens here, once.
 */
export async function buildSubjectContext(
  clock: Clock,
  options: { text?: string; includeWearables?: boolean } = {},
): Promise<SubjectContext> {
  const now = clock.now();
  const window = dayWindow(clock, now);
  const kysely = db();

  const [
    medications,
    supplements,
    interactionResults,
    definitions,
    evaluations,
    meals,
    commitments,
    routines,
    healthHistory,
    recentCheckins,
    latestReceiptTurn,
    observationContext,
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
      .where("provider", "=", "Examine Connect")
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
      .distinctOn("confound_id")
      .where("subject_kind", "=", "window")
      .where("evaluated_ts", ">=", window.start)
      .where("evaluated_ts", "<", window.end)
      .orderBy("confound_id", "asc")
      .orderBy("evaluated_ts", "desc")
      .orderBy("eval_id", "desc")
      .execute(),

    kysely
      .selectFrom("ashwini.meals as meal")
      .leftJoin(
        "ashwini.messages as source_message",
        "source_message.message_id",
        "meal.message_id",
      )
      .select(["meal.kind", "meal.ts"])
      .where("meal.ts", ">=", window.start)
      .where("meal.ts", "<", window.end)
      .where("source_message.corrected_by", "is", null)
      .execute(),

    kysely
      .selectFrom("ashwini.commitments")
      .select(["title", "domain", "starts_at"])
      .where("starts_at", ">=", now)
      .where("starts_at", "<", window.end)
      .orderBy("starts_at", "asc")
      .limit(10)
      .execute(),

    kysely
      .selectFrom("ashwini.routines")
      .select(["routine_id", "name", "domain"])
      .where("status", "=", "active")
      .orderBy("routine_id")
      .execute(),

    buildHealthHistory(),

    kysely
      .selectFrom("ashwini.messages as user_message")
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom("ashwini.messages as advisor_message")
            .select([
              "advisor_message.message_id as advisor_message_id",
              "advisor_message.text as advisor_reply",
              "advisor_message.ts as advisor_at",
            ])
            .whereRef("advisor_message.in_reply_to", "=", "user_message.message_id")
            .where("advisor_message.role", "=", "ashwini")
            .where("advisor_message.corrected_by", "is", null)
            .where("advisor_message.ts", "<=", now)
            .orderBy("advisor_message.ts", "desc")
            .orderBy("advisor_message.message_id", "desc")
            .limit(1)
            .as("reply"),
        (join) => join.onTrue(),
      )
      .select([
        "user_message.message_id",
        "user_message.text",
        "user_message.ts",
        "reply.advisor_message_id",
        "reply.advisor_reply",
        "reply.advisor_at",
        sql<Date>`coalesce(user_message.captured_at, user_message.ts)`.as("event_at"),
      ])
      .where("user_message.role", "=", "user")
      .where("user_message.corrected_by", "is", null)
      .where("user_message.text", "not in", Object.values(SENSITIVE_REDACTION))
      .where("user_message.ts", "<=", now)
      .where(sql<Date>`coalesce(user_message.captured_at, user_message.ts)`, "<=", now)
      // Continuity follows receipt order, not when a delayed report happened.
      // Keep event_at separately so old events never become current evidence.
      .orderBy("user_message.ts", "desc")
      .orderBy("user_message.message_id", "desc")
      .limit(20)
      .execute(),

    // Ineligible text never leaves this module, but its receipt must still block
    // continuity from falling back to a question asked before that turn.
    kysely
      .selectFrom("ashwini.messages")
      .select(["message_id", "ts", "text", "captured_at", "corrected_by"])
      .where("role", "=", "user")
      .where("ts", "<=", now)
      .orderBy("ts", "desc")
      .orderBy("message_id", "desc")
      .limit(1)
      .executeTakeFirst(),

    options.includeWearables === false
      ? Promise.resolve({})
      : buildHealthObservationContext(clock, options, kysely),
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

    activeRoutines: routines.map((routine) => ({
      id: routine.routine_id,
      name: routine.name,
      domain: routine.domain,
      status: "tracking",
    })),

    healthHistory,

    latestReceiptTurn: latestReceiptTurn
      ? {
          id: latestReceiptTurn.message_id,
          receivedAt: latestReceiptTurn.ts,
          eligible:
            latestReceiptTurn.corrected_by === null &&
            (latestReceiptTurn.captured_at === null || latestReceiptTurn.captured_at <= now) &&
            !Object.values(SENSITIVE_REDACTION).includes(latestReceiptTurn.text) &&
            classifySensitiveContent(latestReceiptTurn.text) === null,
        }
      : null,

    recentCheckins: recentCheckins
      // Defense in depth if older records predate protected-content redaction.
      .filter((message) => classifySensitiveContent(message.text) === null)
      .map((message) => ({
        id: message.message_id,
        text: message.text,
        at: message.event_at,
        receivedAt: message.ts,
        advisorReply:
          message.advisor_reply && classifySensitiveContent(message.advisor_reply) === null
            ? message.advisor_reply
            : null,
        advisorMessageId: message.advisor_message_id,
        advisorAt: message.advisor_at,
      })),

    ...observationContext,

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

import { dayWindow, partOfDay, systemClock } from "@/domain/clock";
import { db } from "@/server/db/client";
import { env } from "@/server/env";
import { currentPrincipal } from "@/server/auth";

export const dynamic = "force-dynamic";

/**
 * The record-backed current-day surface.
 *
 * There are intentionally no inferred defaults here. If no row exists, the
 * corresponding array is empty and the client says so. That is what prevents a
 * failed or new record from turning into the old synthetic lunch/training day.
 */
export async function GET(request: Request): Promise<Response> {
  if (!(await currentPrincipal(request))) return unauthorized();

  try {
    const settings = env();
    const clock = systemClock(settings.ASHWINI_TIME_ZONE);
    const now = clock.now();
    const window = dayWindow(clock, now);
    const kysely = db();

    const [commitments, doses, meals, sessions] = await Promise.all([
      kysely
        .selectFrom("ashwini.commitments")
        .select([
          "commitment_id",
          "starts_at",
          "ends_at",
          "domain",
          "title",
          "detail",
          "kind",
          "decision_id",
        ])
        .where("starts_at", ">=", window.start)
        .where("starts_at", "<", window.end)
        .orderBy("starts_at", "asc")
        .execute(),

      kysely
        .selectFrom("ashwini.doses")
        .innerJoin("ashwini.medications", "ashwini.medications.med_id", "ashwini.doses.med_id")
        .select([
          "ashwini.doses.dose_id",
          "ashwini.doses.scheduled_ts",
          "ashwini.doses.taken_ts",
          "ashwini.doses.skipped",
          "ashwini.doses.skip_reason",
          "ashwini.doses.note",
          "ashwini.medications.med_id",
          "ashwini.medications.name as medication_name",
        ])
        .where((eb) =>
          eb.or([
            eb.and([
              eb("ashwini.doses.scheduled_ts", ">=", window.start),
              eb("ashwini.doses.scheduled_ts", "<", window.end),
            ]),
            eb.and([
              eb("ashwini.doses.taken_ts", ">=", window.start),
              eb("ashwini.doses.taken_ts", "<", window.end),
            ]),
          ]),
        )
        .orderBy(
          (eb) => eb.fn.coalesce("ashwini.doses.taken_ts", "ashwini.doses.scheduled_ts"),
          "asc",
        )
        .execute(),

      kysely
        .selectFrom("ashwini.meals as meal")
        .leftJoin("ashwini.messages as source_message", "source_message.message_id", "meal.message_id")
        .select([
          "meal.meal_id",
          "meal.ts",
          "meal.kind",
          "meal.description",
          "meal.source",
          "meal.confidence",
          "meal.kcal_low",
          "meal.kcal_high",
          "meal.protein_low_g",
          "meal.protein_high_g",
          "meal.message_id",
        ])
        .where("meal.ts", ">=", window.start)
        .where("meal.ts", "<", window.end)
        // A correction retains the original row for provenance but supersedes
        // its effect on the current record.
        .where("source_message.corrected_by", "is", null)
        .orderBy("meal.ts", "asc")
        .execute(),

      kysely
        .selectFrom("ashwini.training_sessions")
        .select([
          "session_id",
          "ts",
          "planned",
          "completed",
          "kind",
          "volume_note",
          "perceived_effort",
          "notes",
          "commitment_id",
        ])
        .where("ts", ">=", window.start)
        .where("ts", "<", window.end)
        .orderBy("ts", "asc")
        .execute(),
    ]);

    return Response.json(
      {
        day: window.day,
        timeZone: clock.timeZone(),
        generatedAt: now.toISOString(),
        partOfDay: partOfDay(clock, now),
        commitments: commitments.map((row) => ({
          id: row.commitment_id,
          startsAt: row.starts_at.toISOString(),
          endsAt: row.ends_at?.toISOString() ?? null,
          domain: row.domain,
          title: row.title,
          detail: row.detail,
          kind: row.kind,
          decisionId: row.decision_id,
        })),
        doses: doses.map((row) => ({
          id: row.dose_id,
          scheduledAt: row.scheduled_ts?.toISOString() ?? null,
          takenAt: row.taken_ts?.toISOString() ?? null,
          skipped: row.skipped,
          skipReason: row.skip_reason,
          note: row.note,
          medication: { id: row.med_id, name: row.medication_name },
        })),
        meals: meals.map((row) => ({
          id: row.meal_id,
          at: row.ts.toISOString(),
          kind: row.kind,
          description: row.description,
          source: row.source,
          confidence: row.confidence,
          kcalRange:
            row.kcal_low === null || row.kcal_high === null
              ? null
              : { low: row.kcal_low, high: row.kcal_high },
          proteinRange:
            row.protein_low_g === null || row.protein_high_g === null
              ? null
              : { low: row.protein_low_g, high: row.protein_high_g },
          messageId: row.message_id,
        })),
        trainingSessions: sessions.map((row) => ({
          id: row.session_id,
          at: row.ts.toISOString(),
          planned: row.planned,
          completed: row.completed,
          kind: row.kind,
          volumeNote: row.volume_note,
          perceivedEffort: row.perceived_effort,
          notes: row.notes,
          commitmentId: row.commitment_id,
        })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("Today record query failed", error);
    return problem(503, "TODAY_UNAVAILABLE", "Today’s record is temporarily unavailable.");
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

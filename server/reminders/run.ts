import "server-only";
import { dueReminders, reminderText, type ScheduledDose } from "@/domain/reminders";
import { db } from "../db/client";
import { loggingDispatcher, type ReminderDispatcher } from "./dispatcher";

/**
 * One pass of the reminder scheduler.
 *
 * Reads the doses in the current window, asks the pure domain function which of
 * them need a reminder, sends each, and records what happened.
 *
 * Every attempt is logged, including failures. The current placeholder does
 * not retry a failed row; that limitation is documented rather than presented
 * as reliable delivery.
 */

/** Wide enough to cover a late scheduler run without re-reading the whole table. */
const LOOKBACK_HOURS = 4;
const LOOKAHEAD_HOURS = 1;

export interface ReminderRunResult {
  readonly considered: number;
  readonly sent: number;
  readonly failed: number;
}

export async function runReminders(
  now: Date,
  dispatcher: ReminderDispatcher = loggingDispatcher(),
): Promise<ReminderRunResult> {
  const kysely = db();
  const from = new Date(now.getTime() - LOOKBACK_HOURS * 60 * 60 * 1000);
  const to = new Date(now.getTime() + LOOKAHEAD_HOURS * 60 * 60 * 1000);

  const rows = await kysely
    .selectFrom("ashwini.doses")
    .innerJoin("ashwini.medications", "ashwini.medications.med_id", "ashwini.doses.med_id")
    .select([
      "ashwini.doses.dose_id",
      "ashwini.doses.scheduled_ts",
      "ashwini.doses.taken_ts",
      "ashwini.doses.skipped",
      "ashwini.medications.name",
    ])
    .where("ashwini.doses.scheduled_ts", ">=", from)
    .where("ashwini.doses.scheduled_ts", "<=", to)
    .execute();

  const doses: ScheduledDose[] = rows
    .filter((row): row is typeof row & { scheduled_ts: Date } => row.scheduled_ts !== null)
    .map((row) => ({
      doseId: row.dose_id,
      medicationName: row.name,
      scheduledFor: row.scheduled_ts,
      takenAt: row.taken_ts,
      skipped: row.skipped,
    }));

  const dispatched = await kysely
    .selectFrom("ashwini.reminder_dispatches")
    .select(["dose_id"])
    .where("scheduled_for", ">=", from)
    .where("scheduled_for", "<=", to)
    .execute();

  const due = dueReminders({
    now,
    doses,
    alreadyDispatched: new Set(dispatched.map((row) => row.dose_id)),
  });

  let sent = 0;
  let failed = 0;

  for (const reminder of due) {
    const result = await dispatcher.send(reminder, reminderText(reminder));
    if (result.status === "sent") sent += 1;
    else failed += 1;

    // The (dose_id, scheduled_for) unique constraint makes this the idempotency
    // point: two schedulers racing produce one row, and the loser conflicts.
    await kysely
      .insertInto("ashwini.reminder_dispatches")
      .values({
        dose_id: reminder.doseId,
        scheduled_for: reminder.scheduledFor,
        dispatched_at: now,
        channel: dispatcher.channel,
        status: result.status,
        detail: result.detail,
      })
      .onConflict((oc) => oc.columns(["dose_id", "scheduled_for"]).doNothing())
      .execute();
  }

  return { considered: due.length, sent, failed };
}

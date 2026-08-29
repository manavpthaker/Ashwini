/**
 * Which doses need a reminder right now.
 *
 * Pure, so the part that decides whether to interrupt someone about medication
 * is testable without a database, a clock, or a delivery channel.
 *
 * PRD 11.8 requires that critical dose reminders not depend on a single
 * machine, and 7.3 puts medication in a protected lane. Two consequences shape
 * this module:
 *
 *   - A dose already taken, skipped, or reminded about is never reminded again.
 *     Duplicate nagging about medication is not a cosmetic bug.
 *   - A reminder that is far too late is dropped rather than fired. Waking
 *     someone at 3am about an 8am dose is worse than silence, and the adherence
 *     record already captures the miss.
 */

export interface ScheduledDose {
  readonly doseId: string;
  readonly medicationName: string;
  readonly scheduledFor: Date;
  readonly takenAt: Date | null;
  readonly skipped: boolean;
}

export interface ReminderWindow {
  /** How long before the dose to send the reminder. */
  readonly leadMinutes: number;
  /**
   * How late a dose may be and still be worth a reminder. Past this the moment
   * has gone and the record, not a notification, is the right place for it.
   */
  readonly graceMinutes: number;
}

export const DEFAULT_WINDOW: ReminderWindow = {
  leadMinutes: 10,
  graceMinutes: 120,
};

export interface DueReminder {
  readonly doseId: string;
  readonly medicationName: string;
  readonly scheduledFor: Date;
  /** Minutes until the dose; negative once it is overdue. */
  readonly minutesUntil: number;
  readonly overdue: boolean;
}

export interface DueRemindersInput {
  readonly now: Date;
  readonly doses: readonly ScheduledDose[];
  /** Dose ids a reminder has already gone out for. */
  readonly alreadyDispatched: ReadonlySet<string>;
  readonly window?: ReminderWindow;
}

export function dueReminders({
  now,
  doses,
  alreadyDispatched,
  window = DEFAULT_WINDOW,
}: DueRemindersInput): readonly DueReminder[] {
  const lead = window.leadMinutes * 60_000;
  const grace = window.graceMinutes * 60_000;

  return doses
    .filter((dose) => {
      if (dose.takenAt !== null) return false;
      if (dose.skipped) return false;
      if (alreadyDispatched.has(dose.doseId)) return false;

      const delta = dose.scheduledFor.getTime() - now.getTime();
      // Inside the lead window, or overdue but still within grace.
      return delta <= lead && delta >= -grace;
    })
    .map((dose) => {
      const deltaMinutes = Math.round((dose.scheduledFor.getTime() - now.getTime()) / 60_000);
      return {
        doseId: dose.doseId,
        medicationName: dose.medicationName,
        scheduledFor: dose.scheduledFor,
        minutesUntil: deltaMinutes,
        overdue: deltaMinutes < 0,
      };
    })
    .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());
}

/**
 * The message text.
 *
 * Plain and non-clinical on purpose. A reminder states the fact and the time;
 * it does not advise, and PRD 11.6 means it never suggests changing anything
 * about the dose itself.
 */
export function reminderText(reminder: DueReminder): string {
  if (reminder.overdue) {
    const late = Math.abs(reminder.minutesUntil);
    return late < 60
      ? `${reminder.medicationName} was due ${late} min ago.`
      : `${reminder.medicationName} was due ${Math.floor(late / 60)}h ${late % 60}m ago.`;
  }
  if (reminder.minutesUntil <= 0) return `${reminder.medicationName} is due now.`;
  return `${reminder.medicationName} is due in ${reminder.minutesUntil} min.`;
}

import "server-only";
import type { DueReminder } from "@/domain/reminders";

/**
 * Where a reminder actually goes.
 *
 * A seam rather than a direct call, for the same reason the advisor is one: the
 * delivery channel is the part most likely to change, and PRD 11.8 explicitly
 * wants reminders not to depend on any single mechanism. Swapping or adding a
 * channel should not touch the scheduling logic.
 */

export type DispatchChannel = "brownbot" | "log";

export interface DispatchResult {
  readonly status: "sent" | "failed";
  /** A provider message id on success, the error on failure. Stored either way. */
  readonly detail: string | null;
}

export interface ReminderDispatcher {
  readonly channel: DispatchChannel;
  send(reminder: DueReminder, text: string): Promise<DispatchResult>;
}

/**
 * The fallback, and the default when no channel is configured.
 *
 * It records that a reminder was due and deliberately does not pretend to have
 * delivered anything: `status: "failed"` with a reason, so an undelivered dose
 * reminder is visible in the log rather than silently marked sent. Recording a
 * delivery that did not happen is the one outcome worth avoiding here.
 */
export function loggingDispatcher(): ReminderDispatcher {
  return {
    channel: "log",
    send(reminder, text) {
      process.stdout.write(
        `[reminder] ${reminder.scheduledFor.toISOString()} ${text} (no channel configured)\n`,
      );
      return Promise.resolve({
        status: "failed",
        detail: "No delivery channel is configured; the reminder was logged only.",
      });
    },
  };
}

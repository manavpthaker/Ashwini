import { describe, expect, it } from "vitest";
import { DEFAULT_WINDOW, dueReminders, reminderText, type ScheduledDose } from "@/domain/reminders";

const NOW = new Date("2026-08-29T08:00:00Z");

function dose(overrides: Partial<ScheduledDose> = {}): ScheduledDose {
  return {
    doseId: "dose-1",
    medicationName: "sertraline",
    scheduledFor: new Date("2026-08-29T08:05:00Z"),
    takenAt: null,
    skipped: false,
    ...overrides,
  };
}

const none = new Set<string>();

describe("dueReminders", () => {
  it("fires inside the lead window", () => {
    const due = dueReminders({ now: NOW, doses: [dose()], alreadyDispatched: none });
    expect(due).toHaveLength(1);
    expect(due[0]?.minutesUntil).toBe(5);
    expect(due[0]?.overdue).toBe(false);
  });

  it("stays quiet before the lead window opens", () => {
    const due = dueReminders({
      now: NOW,
      doses: [dose({ scheduledFor: new Date("2026-08-29T09:00:00Z") })],
      alreadyDispatched: none,
    });
    expect(due).toEqual([]);
  });

  it("fires at exactly the lead boundary", () => {
    const at = new Date(NOW.getTime() + DEFAULT_WINDOW.leadMinutes * 60_000);
    const due = dueReminders({
      now: NOW,
      doses: [dose({ scheduledFor: at })],
      alreadyDispatched: none,
    });
    expect(due).toHaveLength(1);
  });

  it("still fires for a dose that is overdue but inside grace", () => {
    const due = dueReminders({
      now: NOW,
      doses: [dose({ scheduledFor: new Date("2026-08-29T07:30:00Z") })],
      alreadyDispatched: none,
    });
    expect(due).toHaveLength(1);
    expect(due[0]?.overdue).toBe(true);
    expect(due[0]?.minutesUntil).toBe(-30);
  });

  it("drops a dose that is far too late to be worth interrupting for", () => {
    // Waking someone at 3am about an 8am dose is worse than silence; the
    // adherence record already holds the miss.
    const due = dueReminders({
      now: NOW,
      doses: [dose({ scheduledFor: new Date("2026-08-29T02:00:00Z") })],
      alreadyDispatched: none,
    });
    expect(due).toEqual([]);
  });

  it("never reminds about a dose already taken", () => {
    const due = dueReminders({
      now: NOW,
      doses: [dose({ takenAt: new Date("2026-08-29T07:58:00Z") })],
      alreadyDispatched: none,
    });
    expect(due).toEqual([]);
  });

  it("never reminds about a dose deliberately skipped", () => {
    const due = dueReminders({
      now: NOW,
      doses: [dose({ skipped: true })],
      alreadyDispatched: none,
    });
    expect(due).toEqual([]);
  });

  it("never reminds twice about the same dose", () => {
    // Duplicate nagging about medication is not a cosmetic bug.
    const due = dueReminders({
      now: NOW,
      doses: [dose()],
      alreadyDispatched: new Set(["dose-1"]),
    });
    expect(due).toEqual([]);
  });

  it("returns the earliest dose first", () => {
    const due = dueReminders({
      now: NOW,
      doses: [
        dose({ doseId: "later", scheduledFor: new Date("2026-08-29T08:09:00Z") }),
        dose({ doseId: "earlier", scheduledFor: new Date("2026-08-29T07:50:00Z") }),
      ],
      alreadyDispatched: none,
    });
    expect(due.map((reminder) => reminder.doseId)).toEqual(["earlier", "later"]);
  });

  it("honours a custom window", () => {
    const due = dueReminders({
      now: NOW,
      doses: [dose({ scheduledFor: new Date("2026-08-29T08:45:00Z") })],
      alreadyDispatched: none,
      window: { leadMinutes: 60, graceMinutes: 30 },
    });
    expect(due).toHaveLength(1);
  });

  it("handles an empty schedule", () => {
    expect(dueReminders({ now: NOW, doses: [], alreadyDispatched: none })).toEqual([]);
  });
});

describe("reminderText", () => {
  const base = { doseId: "d", medicationName: "sertraline", scheduledFor: NOW };

  it("counts down before the dose", () => {
    expect(reminderText({ ...base, minutesUntil: 10, overdue: false })).toBe(
      "sertraline is due in 10 min.",
    );
  });

  it("says due now at zero", () => {
    expect(reminderText({ ...base, minutesUntil: 0, overdue: false })).toBe(
      "sertraline is due now.",
    );
  });

  it("reports minutes late under an hour", () => {
    expect(reminderText({ ...base, minutesUntil: -25, overdue: true })).toBe(
      "sertraline was due 25 min ago.",
    );
  });

  it("reports hours and minutes beyond an hour", () => {
    expect(reminderText({ ...base, minutesUntil: -95, overdue: true })).toBe(
      "sertraline was due 1h 35m ago.",
    );
  });

  it("states the fact without advising anything", () => {
    // PRD 11.6: a reminder never suggests changing a dose.
    const text = reminderText({ ...base, minutesUntil: -30, overdue: true });
    expect(text).not.toMatch(/should|take it|skip|double|adjust|instead/i);
  });
});

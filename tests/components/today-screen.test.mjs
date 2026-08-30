import { describe, expect, test } from "vitest";
import {
  buildTimeline,
  currentPartOfDay,
  needsTodayRefresh,
  nextUpcomingTimelineItem,
} from "@/components/product/today-screen";

const response = (headline) => ({
  kind: "record",
  status: "Recorded",
  gate: "Blocked",
  headline,
  acknowledgement: "",
  interpretation: "",
  recommendation: "Recorded.",
  receipt: "Saved",
  recorded: [],
  perspectives: [],
  effects: {},
});

const checkin = (id, headline, correctionOf) => ({
  id,
  recordedAt: "2026-08-30T15:00:00.000Z",
  time: "11:00 AM",
  originalInput: headline,
  modality: "text",
  ...(correctionOf ? { correctionOf } : {}),
  response: response(headline),
});

const snapshot = (over = {}) => ({
  day: "2026-08-30",
  timeZone: "America/New_York",
  generatedAt: "2026-08-30T16:00:00.000Z",
  partOfDay: "midday",
  commitments: [],
  doses: [],
  meals: [],
  trainingSessions: [],
  ...over,
});

describe("Today timezone state", () => {
  test("part of day follows the current instant in the configured timezone", () => {
    const at = new Date("2026-08-30T15:00:00.000Z");
    expect(currentPartOfDay(at, "America/New_York")).toBe("midday");
    expect(currentPartOfDay(at, "America/Los_Angeles")).toBe("morning");
  });

  test("requests a refresh exactly when the configured-zone date rolls over", () => {
    const current = snapshot();
    expect(needsTodayRefresh(current, new Date("2026-08-31T03:59:00.000Z"))).toBe(false);
    expect(needsTodayRefresh(current, new Date("2026-08-31T04:00:00.000Z"))).toBe(true);
  });
});

describe("Today timeline", () => {
  test("keeps a correction but removes its superseded check-in", () => {
    const timeline = buildTimeline(
      snapshot(),
      [checkin("original", "Old detail"), checkin("correction", "Correct detail", "original")],
      undefined,
      new Date("2026-08-30T16:00:00.000Z"),
    );

    expect(timeline.map((item) => item.title)).toEqual(["Correct detail"]);
  });

  test("chooses the earliest upcoming item across sessions, doses, and commitments", () => {
    const timeline = buildTimeline(
      snapshot({
        trainingSessions: [{
          id: "session",
          at: "2026-08-30T17:00:00.000Z",
          planned: true,
          completed: false,
          kind: "Strength session",
          volumeNote: null,
          perceivedEffort: null,
          notes: null,
          commitmentId: null,
        }],
        doses: [{
          id: "dose",
          scheduledAt: "2026-08-30T18:00:00.000Z",
          takenAt: null,
          skipped: false,
          skipReason: null,
          note: null,
          medication: { id: "med", name: "Medicine" },
        }],
        commitments: [{
          id: "commitment",
          startsAt: "2026-08-30T20:00:00.000Z",
          endsAt: null,
          domain: "training",
          title: "Walk",
          detail: null,
          kind: "training",
          decisionId: null,
        }],
      }),
      [],
      undefined,
      new Date("2026-08-30T16:00:00.000Z"),
    );

    expect(nextUpcomingTimelineItem(timeline, new Date("2026-08-30T16:00:00.000Z"))?.id)
      .toBe("session-session");
  });
});

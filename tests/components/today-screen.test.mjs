import { describe, expect, test } from "vitest";
import {
  buildTimeline,
  currentPartOfDay,
  latestContinuityCheckin,
  needsTodayRefresh,
  nextUpcomingTimelineItem,
  healthBriefIsPrimary,
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

  test("keeps a pending question and a recorded choice visible in the timeline", () => {
    const pending = checkin("pending", "Add one detail");
    pending.response.kind = "follow-up";
    const answered = checkin("answered", "Choose how today changes");
    answered.recordedAt = "2026-08-30T15:30:00.000Z";
    answered.response.decision = {
      id: "decision",
      choices: ["Keep optional effort flexible today", "Do nothing for now"],
      selectedChoice: "Keep optional effort flexible today",
      respondedAt: "2026-08-30T15:31:00.000Z",
    };

    const timeline = buildTimeline(
      snapshot(),
      [pending, answered],
      undefined,
      new Date("2026-08-30T16:00:00.000Z"),
    );

    expect(timeline.map((item) => item.state)).toEqual(["current", "current"]);
    expect(timeline[1]?.detail).toContain("Keep optional effort flexible today");
  });

  test("treats an acknowledged question as closed rather than still pending", () => {
    const acknowledged = checkin("acknowledged", "Review missing evidence");
    acknowledged.response.kind = "follow-up";
    acknowledged.response.decision = {
      id: "decision",
      choices: [],
      selectedChoice: "Acknowledged",
      respondedAt: "2026-08-30T15:31:00.000Z",
    };

    const timeline = buildTimeline(
      snapshot(),
      [acknowledged],
      undefined,
      new Date("2026-08-30T16:00:00.000Z"),
    );

    expect(timeline[0]?.state).toBe("complete");
  });
});

describe("Today continuity priority", () => {
  test("shows an imported brief only after decisions are available and no safety/action/pending response takes priority", () => {
    const state = { decisionsLoading: false, decisionsError: null, hasDecision: false, hasPending: false, hasAnswered: false, available: true };
    expect(healthBriefIsPrimary(state)).toBe(true);
    expect(healthBriefIsPrimary({ ...state, hasDecision: true })).toBe(false);
    expect(healthBriefIsPrimary({ ...state, hasPending: true })).toBe(false);
    expect(healthBriefIsPrimary({ ...state, hasAnswered: true })).toBe(false);
    expect(healthBriefIsPrimary({ ...state, decisionsLoading: true })).toBe(false);
    expect(healthBriefIsPrimary({ ...state, decisionsError: "Decision read failed" })).toBe(false);
    expect(healthBriefIsPrimary({ ...state, available: false })).toBe(false);
  });
  test("shows the newest recorded response ahead of an older pending question", () => {
    const pending = checkin("pending", "Add one detail");
    pending.response.kind = "follow-up";

    const answered = checkin("answered", "Choose how today changes");
    answered.recordedAt = "2026-08-30T14:00:00.000Z";
    answered.response.decision = {
      id: "decision",
      choices: ["Keep optional effort flexible today", "Do nothing for now"],
      selectedChoice: "Keep optional effort flexible today",
      respondedAt: "2026-08-30T16:00:00.000Z",
    };

    expect(latestContinuityCheckin([pending, answered])?.id).toBe("answered");
  });

  test("shows a genuinely newer pending question ahead of an older response", () => {
    const answered = checkin("answered", "Earlier response");
    answered.response.decision = {
      id: "decision",
      choices: ["Reduced volume"],
      selectedChoice: "Reduced volume",
      respondedAt: "2026-08-30T14:00:00.000Z",
    };

    const pending = checkin("pending", "New detail needed");
    pending.recordedAt = "2026-08-30T16:00:00.000Z";
    pending.response.kind = "follow-up";

    expect(latestContinuityCheckin([answered, pending])?.id).toBe("pending");
  });
});

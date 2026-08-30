import { describe, expect, it } from "vitest";
import {
  dayWindow,
  fixedClock,
  localDay,
  minutesUntil,
  partOfDay,
  systemClock,
} from "@/domain/clock";

describe("fixedClock", () => {
  it("returns the same instant every time", () => {
    const clock = fixedClock("2025-06-27T12:18:00Z");
    expect(clock.now().toISOString()).toBe("2025-06-27T12:18:00.000Z");
    expect(clock.now().toISOString()).toBe("2025-06-27T12:18:00.000Z");
  });

  it("hands out copies, so a caller cannot mutate the frozen instant", () => {
    const clock = fixedClock("2025-06-27T12:18:00Z");
    const first = clock.now();
    first.setFullYear(1999);
    expect(clock.now().getUTCFullYear()).toBe(2025);
  });

  it("rejects an unparseable instant rather than yielding an Invalid Date", () => {
    expect(() => fixedClock("not-a-date")).toThrow(/unparseable instant/);
  });

  it("reports the time zone it was given", () => {
    expect(fixedClock("2025-06-27T12:18:00Z", "America/Los_Angeles").timeZone()).toBe(
      "America/Los_Angeles",
    );
    expect(fixedClock("2025-06-27T12:18:00Z").timeZone()).toBe("UTC");
  });
});

describe("systemClock", () => {
  it("advances with real time and carries the configured zone", () => {
    const clock = systemClock("America/New_York");
    expect(clock.timeZone()).toBe("America/New_York");
    expect(clock.now().getTime()).toBeGreaterThan(0);
  });
});

describe("partOfDay", () => {
  // PRD 4.2: the brief is time-of-day aware, so these boundaries are product behaviour.
  const cases: ReadonlyArray<[string, ReturnType<typeof partOfDay>]> = [
    ["2025-06-27T00:30:00Z", "night"],
    ["2025-06-27T04:59:00Z", "night"],
    ["2025-06-27T05:00:00Z", "early-morning"],
    ["2025-06-27T07:59:00Z", "early-morning"],
    ["2025-06-27T08:00:00Z", "morning"],
    ["2025-06-27T10:59:00Z", "morning"],
    ["2025-06-27T11:00:00Z", "midday"],
    ["2025-06-27T13:59:00Z", "midday"],
    ["2025-06-27T14:00:00Z", "afternoon"],
    ["2025-06-27T16:59:00Z", "afternoon"],
    ["2025-06-27T17:00:00Z", "evening"],
    ["2025-06-27T21:59:00Z", "evening"],
    ["2025-06-27T22:00:00Z", "night"],
    ["2025-06-27T23:59:00Z", "night"],
  ];

  for (const [iso, expected] of cases) {
    it(`treats ${iso} as ${expected}`, () => {
      expect(partOfDay(fixedClock(iso))).toBe(expected);
    });
  }

  it("resolves against the clock's zone, not UTC", () => {
    // 19:18 UTC is midday in Los Angeles (UTC-7 in June).
    const clock = fixedClock("2025-06-27T19:18:00Z", "America/Los_Angeles");
    expect(partOfDay(clock)).toBe("midday");
    expect(partOfDay(fixedClock("2025-06-27T19:18:00Z"))).toBe("evening");
  });

  it("accepts an explicit instant that differs from the clock's own", () => {
    const clock = fixedClock("2025-06-27T12:18:00Z");
    expect(partOfDay(clock, new Date("2025-06-27T23:00:00Z"))).toBe("night");
  });
});

describe("localDay", () => {
  it("formats the local calendar date", () => {
    expect(localDay(fixedClock("2025-06-27T12:18:00Z"))).toBe("2025-06-27");
  });

  it("rolls back a day when the zone is behind UTC", () => {
    const clock = fixedClock("2025-06-27T02:00:00Z", "America/Los_Angeles");
    expect(localDay(clock)).toBe("2025-06-26");
  });

  it("accepts an explicit instant", () => {
    const clock = fixedClock("2025-06-27T12:18:00Z");
    expect(localDay(clock, new Date("2025-07-04T12:00:00Z"))).toBe("2025-07-04");
  });
});

describe("dayWindow", () => {
  it("uses configured-zone midnight rather than UTC midnight", () => {
    const window = dayWindow(fixedClock("2025-06-27T16:00:00Z", "America/New_York"));
    expect(window.day).toBe("2025-06-27");
    expect(window.start.toISOString()).toBe("2025-06-27T04:00:00.000Z");
    expect(window.end.toISOString()).toBe("2025-06-28T04:00:00.000Z");
  });

  it("honours the short daylight-saving day", () => {
    const window = dayWindow(fixedClock("2025-03-09T16:00:00Z", "America/New_York"));
    expect(window.start.toISOString()).toBe("2025-03-09T05:00:00.000Z");
    expect(window.end.toISOString()).toBe("2025-03-10T04:00:00.000Z");
    expect(window.end.getTime() - window.start.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it("honours the long daylight-saving day", () => {
    const window = dayWindow(fixedClock("2025-11-02T17:00:00Z", "America/New_York"));
    expect(window.start.toISOString()).toBe("2025-11-02T04:00:00.000Z");
    expect(window.end.toISOString()).toBe("2025-11-03T05:00:00.000Z");
    expect(window.end.getTime() - window.start.getTime()).toBe(25 * 60 * 60 * 1000);
  });
});

describe("minutesUntil", () => {
  it("counts whole minutes to a future instant", () => {
    // The prototype hardcoded "4h 12m"; this is the computation behind it.
    const from = new Date("2025-06-27T12:18:00Z");
    const target = new Date("2025-06-27T16:30:00Z");
    expect(minutesUntil(from, target)).toBe(252);
  });

  it("floors partial minutes", () => {
    const from = new Date("2025-06-27T12:18:00Z");
    expect(minutesUntil(from, new Date("2025-06-27T12:19:59Z"))).toBe(1);
  });

  it("returns zero at the instant itself", () => {
    const at = new Date("2025-06-27T12:18:00Z");
    expect(minutesUntil(at, at)).toBe(0);
  });

  it("returns null once the instant has passed, rather than a negative countdown", () => {
    const from = new Date("2025-06-27T17:00:00Z");
    expect(minutesUntil(from, new Date("2025-06-27T16:30:00Z"))).toBeNull();
  });
});

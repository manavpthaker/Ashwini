/**
 * The time seam.
 *
 * Every temporal value in the product goes through a Clock. Nothing calls
 * `new Date()` or `Date.now()` directly outside this file, because the Now
 * surface (PRD 4.2) is time-of-day aware and untestable if time is ambient.
 *
 * The server renders in ASHWINI_TIME_ZONE; a browser renders in the device
 * zone. Any formatting that crosses that boundary must pass an explicit
 * timeZone or it will hydrate inconsistently.
 */

export interface Clock {
  now(): Date;
  timeZone(): string;
}

export function systemClock(timeZone: string): Clock {
  return {
    now: () => new Date(),
    timeZone: () => timeZone,
  };
}

/** A clock frozen at one instant, for tests and for deterministic seed data. */
export function fixedClock(iso: string, timeZone = "UTC"): Clock {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) {
    throw new Error(`fixedClock received an unparseable instant: ${iso}`);
  }
  return {
    now: () => new Date(instant),
    timeZone: () => timeZone,
  };
}

export type PartOfDay = "early-morning" | "morning" | "midday" | "afternoon" | "evening" | "night";

/**
 * PRD 4.2: the home screen "is time-of-day aware, not merely a daily dashboard".
 * These boundaries decide which brief the user opens into.
 */
export function partOfDay(clock: Clock, at: Date = clock.now()): PartOfDay {
  const hour = hourIn(clock.timeZone(), at);
  if (hour < 5) return "night";
  if (hour < 8) return "early-morning";
  if (hour < 11) return "morning";
  if (hour < 14) return "midday";
  if (hour < 17) return "afternoon";
  if (hour < 22) return "evening";
  return "night";
}

/** The local calendar date as YYYY-MM-DD, which is the key records are bucketed by. */
export function localDay(clock: Clock, at: Date = clock.now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: clock.timeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export interface DayWindow {
  /** The configured-zone calendar day, YYYY-MM-DD. */
  readonly day: string;
  /** Inclusive UTC instant at local midnight. */
  readonly start: Date;
  /** Exclusive UTC instant at the next local midnight. */
  readonly end: Date;
}

/**
 * Resolve one local calendar day to real UTC instants.
 *
 * Appending `T00:00:00Z` to a local date is wrong anywhere outside UTC and is
 * especially wrong across daylight-saving changes. Intl gives us the civil
 * time represented by a candidate instant; a short fixed-point adjustment then
 * finds the instant whose civil time is the requested midnight.
 */
export function dayWindow(clock: Clock, at: Date = clock.now()): DayWindow {
  const day = localDay(clock, at);
  const nextDay = addCalendarDay(day);
  return {
    day,
    start: zonedMidnight(day, clock.timeZone()),
    end: zonedMidnight(nextDay, clock.timeZone()),
  };
}

function addCalendarDay(day: string): string {
  const [year, month, date] = parseDay(day);
  const next = new Date(Date.UTC(year, month - 1, date + 1));
  return [
    next.getUTCFullYear(),
    String(next.getUTCMonth() + 1).padStart(2, "0"),
    String(next.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function zonedMidnight(day: string, timeZone: string): Date {
  const [year, month, date] = parseDay(day);
  const wanted = Date.UTC(year, month - 1, date, 0, 0, 0);
  let candidate = wanted;

  for (let pass = 0; pass < 4; pass += 1) {
    const parts = civilParts(new Date(candidate), timeZone);
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const correction = wanted - represented;
    candidate += correction;
    if (correction === 0) break;
  }

  return new Date(candidate);
}

function parseDay(day: string): readonly [number, number, number] {
  // Internal only: `day` is produced by localDay(), which owns this format.
  const parts = day.split("-");
  return [Number(parts[0]!), Number(parts[1]!), Number(parts[2]!)];
}

function civilParts(at: Date, timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: values.year as number,
    month: values.month as number,
    day: values.day as number,
    hour: (values.hour as number) % 24,
    minute: values.minute as number,
    second: values.second as number,
  };
}

function hourIn(timeZone: string, at: Date): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: false,
  }).format(at);
  // Intl renders midnight as "24" in some locales/engines; normalise to 0.
  return Number(hour) % 24;
}

/**
 * Whole minutes until an instant, floored, or null when it has already passed.
 * The prototype hardcoded "4h 12m"; this is what replaces it.
 */
export function minutesUntil(from: Date, target: Date): number | null {
  const delta = target.getTime() - from.getTime();
  if (delta < 0) return null;
  return Math.floor(delta / 60_000);
}

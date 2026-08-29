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

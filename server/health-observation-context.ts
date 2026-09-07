import "server-only";
import { createHash } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { dayWindow, localDay, type Clock } from "@/domain/clock";
import type {
  HealthMetricSummary,
  HealthObservationCoverage,
  SubjectContext,
} from "@/domain/advisor/types";
import type { Database } from "./db/types";
import { db } from "./db/client";

const DAY = 86_400_000;
const quantity = "HKQuantityTypeIdentifier";
type Metric = {
  type: string;
  label: string;
  aggregation: HealthMetricSummary["aggregation"];
  limit: number;
  unit?: string;
};

/** Explicit supported metrics keep an unrelated high-volume stream from hiding sleep or weight. */
export const HEALTH_METRICS: readonly Metric[] = [
  {
    type: "HKCategoryTypeIdentifierSleepAnalysis",
    label: "Recorded sleep",
    aggregation: "recorded_duration",
    limit: 1024,
    unit: "hours",
  },
  ...[
    ["StepCount", "Recorded steps", "recorded_total", 768],
    ["ActiveEnergyBurned", "Recorded active energy", "recorded_total", 512],
    ["AppleExerciseTime", "Recorded exercise time", "recorded_total", 256],
    ["DistanceWalkingRunning", "Recorded walking/running distance", "recorded_total", 256],
    ["FlightsClimbed", "Recorded flights climbed", "recorded_total", 128],
    ["HeartRate", "Sampled heart rate", "sample_mean", 256],
    ["RestingHeartRate", "Recorded resting heart rate", "latest", 64],
    ["HeartRateVariabilitySDNN", "Sampled heart-rate variability", "sample_mean", 128],
    ["WalkingHeartRateAverage", "Recorded walking heart rate", "latest", 64],
    ["RespiratoryRate", "Sampled respiratory rate", "sample_mean", 128],
    ["OxygenSaturation", "Sampled oxygen saturation", "sample_mean", 64],
    ["BodyMass", "Recorded body weight", "latest", 64],
    ["BodyFatPercentage", "Recorded body fat", "latest", 64],
    ["LeanBodyMass", "Recorded lean body mass", "latest", 64],
    ["BodyMassIndex", "Recorded BMI", "latest", 64],
    ["VO2Max", "Recorded estimated VO2 max", "latest", 64],
    ["BloodPressureSystolic", "Recorded systolic blood pressure", "latest", 64],
    ["BloodPressureDiastolic", "Recorded diastolic blood pressure", "latest", 64],
    ["DietaryWater", "Recorded water", "recorded_total", 128],
    ["DietaryEnergyConsumed", "Recorded dietary energy", "recorded_total", 128],
    ["DietaryProtein", "Recorded dietary protein", "recorded_total", 128],
  ].map(([suffix, label, aggregation, limit]) => ({
    type: `${quantity}${suffix}`,
    label: String(label),
    aggregation: aggregation as Metric["aggregation"],
    limit: Number(limit),
  })),
];

export interface ObservationRow {
  type: string;
  label: string;
  sample_limit: number;
  latest_end_at: Date | null;
  identity: string | null;
  unit: string | null;
  source_name: string | null;
  source_key: string | null;
  device: string | null;
  value: string | null;
  start_at: Date | null;
  end_at: Date | null;
}

export type HealthObservationContext = Pick<
  SubjectContext,
  "healthObservations" | "healthSummaries" | "healthObservationCoverage"
>;

/**
 * Every LATERAL branch seeks the existing (type, end_at DESC) index and stops.
 * No full-history DISTINCT, global device-string sort or full-history aggregate.
 * Windows anchor to each metric's latest record so old sleep remains visible.
 */
export function healthObservationQuery(now: Date, options: { text?: string } = {}) {
  const text = options.text?.toLowerCase() ?? "";
  const focused = text.length > 0;
  const metrics = HEALTH_METRICS.map((metric) => {
    const relevant =
      !focused ||
      /sleep|tired|fatigue|recover|health|history|context|doing|baseline/.test(text) ||
      (/food|eat|meal|protein|water|weight|nutrition/.test(text) &&
        /Dietary|Body/.test(metric.type)) ||
      (/train|workout|walk|run|exercise/.test(text) &&
        /Step|Energy|Exercise|Distance|Heart|VO2/.test(metric.type));
    return { ...metric, limit: relevant ? metric.limit : Math.min(32, metric.limit) };
  });
  return sql<ObservationRow>`
    select metric.type, metric.label, metric.sample_limit, latest.end_at as latest_end_at,
      sample.identity, sample.unit, sample.source_name,
      md5(coalesce(sample.source_name, '') || E'\\x1f' || coalesce(
        regexp_replace(sample.device, '^<<HKDevice: 0x[0-9a-fA-F]+>', '<HKDevice>'), '')) as source_key,
      left(sample.device, 160) as device, sample.value, sample.start_at, sample.end_at
    from (values ${sql.join(metrics.map((metric) => sql`(${metric.type}::text, ${metric.label}::text, ${metric.limit}::int)`))})
      as metric(type, label, sample_limit)
    left join lateral (
      select end_at from ashwini.health_observations
      where type = metric.type and end_at <= ${now}
      order by end_at desc limit 1
    ) latest on true
    left join lateral (
      select identity, unit, source_name, device, value, start_at, end_at
      from ashwini.health_observations
      where type = metric.type and end_at <= latest.end_at
        and end_at >= latest.end_at - interval '14 days'
      order by end_at desc limit metric.sample_limit + 1
    ) sample on true`;
}

export async function buildHealthObservationContext(
  clock: Clock,
  options: { text?: string } = {},
  connection: Kysely<Database> = db(),
): Promise<HealthObservationContext> {
  const result = await healthObservationQuery(clock.now(), options).execute(connection);
  return summariseHealthObservations(result.rows, clock);
}

type Reading = ObservationRow & {
  identity: string;
  source_name: string;
  source_key: string;
  value: string;
  start_at: Date;
  end_at: Date;
};
function isReading(row: ObservationRow): row is Reading {
  return (
    row.identity !== null &&
    row.source_name !== null &&
    row.source_key !== null &&
    row.value !== null &&
    row.start_at !== null &&
    row.end_at !== null
  );
}

/** Pure summary step: no clinical ranges, personal effects or inferred sensor coverage. */
export function summariseHealthObservations(
  rows: readonly ObservationRow[],
  clock: Clock,
): HealthObservationContext {
  const now = clock.now();
  const summaries: HealthMetricSummary[] = [];
  const coverage: HealthObservationCoverage[] = [];
  const observations: NonNullable<SubjectContext["healthObservations"]>[number][] = [];
  for (const metric of HEALTH_METRICS) {
    const all = rows.filter((row) => row.type === metric.type);
    const latestCandidate = all[0]?.latest_end_at ?? null;
    const latest = latestCandidate && latestCandidate <= now ? latestCandidate : null;
    const limit = all[0]?.sample_limit ?? metric.limit;
    const readings = all
      .filter(isReading)
      .filter((row) => row.end_at <= now)
      .sort(
        (a, b) => b.end_at.getTime() - a.end_at.getTime() || a.identity.localeCompare(b.identity),
      );
    const truncated = readings.length > limit;
    const selected = readings.slice(0, limit);
    coverage.push({
      type: metric.type,
      label: metric.label,
      latestEndAt: latest?.toISOString() ?? null,
      freshness: latest === null ? "missing" : freshness(latest, now),
      windowTruncated: truncated,
    });
    const streams = new Map<string, Reading[]>();
    for (const row of selected) {
      const key = `${row.source_key}:${row.unit ?? ""}`;
      const group = streams.get(key) ?? [];
      group.push(row);
      streams.set(key, group);
    }
    // Preserve multiple devices without allowing one type to consume the whole input.
    for (const group of [...streams.values()].slice(0, 4)) {
      const first = group[0]!;
      observations.push({
        id: first.identity,
        type: first.type,
        unit: first.unit,
        sourceName: first.source_name,
        device: first.device,
        latestValue: first.value,
        latestStartAt: first.start_at.toISOString(),
        latestEndAt: first.end_at.toISOString(),
        samplesInInput: 1,
      });
    }
    for (const group of streams.values()) {
      summaries.push(...summariseStream(metric, group, clock, truncated, latest));
    }
  }
  // Fair per-metric selection: dense activity never crowds out old sleep/weight.
  const selectedSummaries = HEALTH_METRICS.flatMap((metric) =>
    summaries
      .filter((row) => row.type === metric.type)
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) || b.sampleCount - a.sampleCount || a.id.localeCompare(b.id),
      )
      .slice(0, 4),
  );
  return {
    healthObservations: observations,
    healthSummaries: selectedSummaries,
    healthObservationCoverage: coverage,
  };
}

function freshness(at: Date, now: Date): "recent" | "historical" {
  return now.getTime() - at.getTime() <= 7 * DAY ? "recent" : "historical";
}

type Portion = { row: Reading; start: number; end: number; boundary: boolean };
function summariseStream(
  metric: Metric,
  rows: Reading[],
  clock: Clock,
  truncated: boolean,
  latest: Date | null,
): HealthMetricSummary[] {
  const days = new Map<string, Portion[]>();
  let invalidRecordsOmitted = false;
  for (const row of rows) {
    if (
      metric.aggregation === "recorded_duration" &&
      !/^HKCategoryValueSleepAnalysisAsleep(?:Unspecified|Core|Deep|REM)?$/.test(row.value)
    ) {
      if (!/^HKCategoryValueSleepAnalysis(?:InBed|Awake)$/.test(row.value))
        invalidRecordsOmitted = true;
      continue;
    }
    if (
      metric.aggregation !== "recorded_duration" &&
      (!Number.isFinite(Number(row.value)) || row.value.trim() === "" || Number(row.value) < 0)
    ) {
      invalidRecordsOmitted = true;
      continue;
    }
    if (row.end_at < row.start_at) {
      invalidRecordsOmitted = true;
      continue;
    }
    if (metric.aggregation === "recorded_duration") {
      // Calendar-day sleep duration, not an invented "nightly total". DST uses real UTC elapsed time.
      let start = row.start_at.getTime();
      const end = row.end_at.getTime();
      // Malformed multi-week sleep intervals are not plausible sleep evidence.
      if (end - start > 2 * DAY || end === start) {
        invalidRecordsOmitted = true;
        continue;
      }
      while (start < end) {
        const window = dayWindow(clock, new Date(start));
        const partEnd = Math.min(end, window.end.getTime());
        const portions = days.get(window.day) ?? [];
        portions.push({ row, start, end: partEnd, boundary: false });
        days.set(window.day, portions);
        start = partEnd;
      }
    } else {
      const date = localDay(clock, row.end_at);
      const portions = days.get(date) ?? [];
      portions.push({
        row,
        start: row.start_at.getTime(),
        end: row.end_at.getTime(),
        boundary: metric.aggregation === "recorded_total" && localDay(clock, row.start_at) !== date,
      });
      days.set(date, portions);
    }
  }
  return [...days.entries()].flatMap(([date, portions]) => {
    const first = portions[0]!.row;
    let contributors = portions;
    let partial = truncated || invalidRecordsOmitted || portions.some((part) => part.boundary);
    let value: number;
    let aggregation = metric.aggregation;
    if (aggregation === "recorded_duration") {
      value = unionDuration(portions) / 3_600_000;
    } else if (aggregation === "recorded_total") {
      let previousEnd = -Infinity;
      let previousPoint = -Infinity;
      value = 0;
      contributors = [];
      for (const part of [...portions].sort((a, b) => a.start - b.start || a.end - b.end)) {
        if (
          part.boundary ||
          part.start < previousEnd ||
          (part.start === part.end && part.start === previousPoint)
        ) {
          partial = true;
          continue;
        }
        value += Number(part.row.value);
        contributors.push(part);
        previousEnd = part.end;
        previousPoint = part.start === part.end ? part.start : -Infinity;
      }
    } else if (aggregation === "sample_mean" && portions.length > 1) {
      value = portions.reduce((sum, part) => sum + Number(part.row.value), 0) / portions.length;
    } else {
      aggregation = "latest";
      value = Number([...portions].sort((a, b) => b.end - a.end)[0]!.row.value);
    }
    // Missing/unallocatable data is not a recorded zero.
    if (contributors.length === 0) return [];
    const start = Math.min(...contributors.map((part) => part.start));
    const end = Math.max(...contributors.map((part) => part.end));
    // A sleep portion ending exactly at midnight belongs to its starting day.
    const dayStart = dayWindow(
      clock,
      new Date(aggregation === "recorded_duration" ? start : end),
    ).start.getTime();
    if (latest && dayStart < latest.getTime() - 14 * DAY) partial = true;
    if (date === localDay(clock)) partial = true;
    const notes = ["Imported snapshot; not continuous sync. Source/device groups are separate."];
    if (invalidRecordsOmitted) notes.push("Unusable records were omitted from this source window.");
    if (aggregation === "recorded_duration")
      notes.push(
        "Overlapping asleep stages merged; awake/in-bed excluded. Hours within this local calendar day, not a nightly total.",
      );
    if (aggregation === "recorded_total")
      notes.push(
        "Only non-overlapping same-source records are added; cross-midnight/overlapping records are omitted. Recorded amount, not total daily behavior.",
      );
    if (aggregation === "sample_mean")
      notes.push("Mean of these samples, not a time-weighted daily average or personal baseline.");
    if (aggregation === "latest")
      notes.push("Latest sampled value on this date; no trend or personal effect established.");
    if (partial)
      notes.push("Partial bounded window; do not treat this as complete daily coverage.");
    else
      notes.push(
        "All available records in this bounded window; sensor wear and complete daily coverage are unknown.",
      );
    if (!Number.isFinite(value)) return [];
    const sourceIds = [...new Set(contributors.map((part) => part.row.identity))].sort();
    const roundedValue = Math.round(value * 1000) / 1000;
    // A summary identifies its exact evidence snapshot, not merely a reusable day bucket.
    // Appending another sample must produce a new identity even when the first refs are unchanged.
    const summaryId = createHash("sha256")
      .update(
        JSON.stringify({
          version: 1,
          type: first.type,
          sourceKey: first.source_key,
          unit: first.unit,
          date,
          aggregation,
          start,
          end,
          value: roundedValue,
          partial,
          note: notes.join(" "),
          sourceIds,
        }),
      )
      .digest("hex");
    return [
      {
        id: summaryId,
        type: first.type,
        label: metric.label,
        sourceName: first.source_name,
        sourceKey: first.source_key,
        unit: metric.unit ?? first.unit ?? "unit not supplied",
        date,
        periodStartAt: new Date(start).toISOString(),
        periodEndAt: new Date(end).toISOString(),
        value: roundedValue,
        sampleCount: new Set(contributors.map((part) => part.row.identity)).size,
        aggregation,
        coverage: partial ? ("partial" as const) : ("bounded_complete" as const),
        freshness: freshness(new Date(end), clock.now()),
        note: notes.join(" "),
        sourceIds,
      },
    ];
  });
}

function unionDuration(portions: Portion[]): number {
  let duration = 0;
  let end = -Infinity;
  for (const part of [...portions].sort((a, b) => a.start - b.start || a.end - b.end)) {
    duration += Math.max(0, part.end - Math.max(end, part.start));
    end = Math.max(end, part.end);
  }
  return duration;
}

import { describe, expect, it } from "vitest";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { fixedClock } from "@/domain/clock";
import {
  HEALTH_METRICS,
  healthObservationQuery,
  summariseHealthObservations,
  type ObservationRow,
} from "@/server/health-observation-context";

const sleep = "HKCategoryTypeIdentifierSleepAnalysis";
const steps = "HKQuantityTypeIdentifierStepCount";
const clock = fixedClock("2026-09-07T12:00:00Z");
function row(overrides: Partial<ObservationRow> = {}): ObservationRow {
  return {
    type: sleep,
    label: "Recorded sleep",
    sample_limit: 1024,
    latest_end_at: new Date("2026-06-07T08:00:00Z"),
    identity: "a".repeat(64),
    unit: null,
    source_name: "Synthetic Watch",
    source_key: "synthetic-device-1",
    device: "watch-1",
    value: "HKCategoryValueSleepAnalysisAsleepCore",
    start_at: new Date("2026-06-07T01:00:00Z"),
    end_at: new Date("2026-06-07T08:00:00Z"),
    ...overrides,
  };
}

describe("bounded wearable context", () => {
  it("compiles index-seeking bounded lateral branches, not a global DISTINCT", () => {
    // Compile only. No connection is opened and no health data is sent anywhere.
    const connection = new Kysely({ dialect: new PostgresDialect({ pool: new Pool() }) });
    const query = healthObservationQuery(clock.now(), { text: "How did I sleep?" }).compile(
      connection,
    );
    expect(query.sql).toContain("left join lateral");
    expect(query.sql).toContain("limit metric.sample_limit + 1");
    expect(query.sql).toContain("type = metric.type and end_at <=");
    expect(query.sql).toContain("interval '14 days'");
    expect(query.sql.toLowerCase()).not.toContain("distinct");
    expect(query.parameters).toContain(sleep);
    expect(query.parameters).toContain("HKQuantityTypeIdentifierHeartRate");
    expect(query.parameters).toContain("HKQuantityTypeIdentifierBodyMass");
  });

  it("unions overlapping asleep stages but excludes awake/in-bed and separates devices", () => {
    const result = summariseHealthObservations(
      [
        row(),
        row({
          identity: "b".repeat(64),
          value: "HKCategoryValueSleepAnalysisAsleepREM",
          start_at: new Date("2026-06-07T06:00:00Z"),
        }),
        row({
          identity: "c".repeat(64),
          value: "HKCategoryValueSleepAnalysisInBed",
          start_at: new Date("2026-06-07T00:00:00Z"),
        }),
        row({
          identity: "d".repeat(64),
          value: "HKCategoryValueSleepAnalysisAwake",
          start_at: new Date("2026-06-07T00:00:00Z"),
        }),
        row({
          identity: "e".repeat(64),
          source_key: "synthetic-device-2",
          device: "watch-2",
          start_at: new Date("2026-06-07T04:00:00Z"),
        }),
      ],
      clock,
    );
    expect(result.healthSummaries).toHaveLength(2);
    expect(result.healthSummaries?.map((entry) => entry.value).sort()).toEqual([4, 7]);
    expect(result.healthSummaries?.[0]).toMatchObject({
      unit: "hours",
      date: "2026-06-07",
      freshness: "historical",
    });
    expect(result.healthSummaries?.[0]?.note).toContain("not a nightly total");
    expect(
      result.healthSummaries?.find((entry) => entry.sourceKey === "synthetic-device-1")
        ?.sampleCount,
    ).toBe(2);
    expect(result.healthObservations).toHaveLength(2);
  });

  it("splits sleep at actual local midnight and uses elapsed time across daylight saving", () => {
    const result = summariseHealthObservations(
      [
        row({
          start_at: new Date("2026-03-08T04:00:00Z"),
          end_at: new Date("2026-03-08T12:00:00Z"),
          latest_end_at: new Date("2026-03-08T12:00:00Z"),
        }),
      ],
      fixedClock("2026-03-10T12:00:00Z", "America/New_York"),
    );
    expect(result.healthSummaries?.map((entry) => [entry.date, entry.value])).toEqual([
      ["2026-03-08", 7],
      ["2026-03-07", 1],
    ]);
  });

  it("does not call truncated sample windows complete or use them as personal trends", () => {
    const result = summariseHealthObservations(
      [
        row({ sample_limit: 1 }),
        row({
          identity: "b".repeat(64),
          sample_limit: 1,
          end_at: new Date("2026-06-06T08:00:00Z"),
        }),
      ],
      clock,
    );
    expect(result.healthObservationCoverage?.find((entry) => entry.type === sleep)).toMatchObject({
      windowTruncated: true,
    });
    expect(result.healthSummaries?.[0]?.coverage).toBe("partial");
    expect(result.healthSummaries?.[0]?.note).toContain(
      "do not treat this as complete daily coverage",
    );
  });

  it("does not add overlapping activity or conflate different units", () => {
    const result = summariseHealthObservations(
      [
        row({
          type: steps,
          value: "100",
          unit: "count",
          start_at: new Date("2026-06-07T01:00:00Z"),
          end_at: new Date("2026-06-07T02:00:00Z"),
        }),
        row({
          type: steps,
          identity: "b".repeat(64),
          value: "200",
          unit: "count",
          start_at: new Date("2026-06-07T01:30:00Z"),
          end_at: new Date("2026-06-07T03:00:00Z"),
        }),
        row({
          type: steps,
          identity: "c".repeat(64),
          value: "50",
          unit: "other-unit",
          start_at: new Date("2026-06-07T01:00:00Z"),
          end_at: new Date("2026-06-07T02:00:00Z"),
        }),
      ],
      clock,
    );
    expect(result.healthSummaries?.find((entry) => entry.unit === "count")).toMatchObject({
      value: 100,
      coverage: "partial",
    });
    expect(result.healthSummaries?.find((entry) => entry.unit === "other-unit")?.value).toBe(50);
  });

  it("omits unallocatable cross-midnight activity instead of assigning its whole total to one day", () => {
    const result = summariseHealthObservations(
      [
        row({
          type: steps,
          value: "100",
          unit: "count",
          start_at: new Date("2026-06-06T23:00:00Z"),
          end_at: new Date("2026-06-07T01:00:00Z"),
        }),
      ],
      clock,
    );
    expect(result.healthSummaries).toEqual([]);
    expect(
      result.healthObservationCoverage?.find((entry) => entry.type === steps)?.latestEndAt,
    ).not.toBeNull();
  });

  it("keeps a sleep portion ending at midnight on its original partial-boundary day", () => {
    const result = summariseHealthObservations(
      [
        row({
          start_at: new Date("2026-06-01T23:00:00Z"),
          end_at: new Date("2026-06-02T00:00:00Z"),
          latest_end_at: new Date("2026-06-15T12:00:00Z"),
        }),
      ],
      clock,
    );
    expect(result.healthSummaries?.[0]).toMatchObject({
      date: "2026-06-01",
      value: 1,
      coverage: "partial",
    });
  });

  it("labels single values honestly and never hides sparse metrics behind dense activity", () => {
    const result = summariseHealthObservations(
      [
        row(),
        ...Array.from({ length: 40 }, (_, index) =>
          row({
            type: steps,
            identity: String(index),
            source_key: `device-${index}`,
            value: "100",
            unit: "count",
          }),
        ),
        row({ type: "HKQuantityTypeIdentifierBodyMass", value: "70", unit: "kg" }),
        row({ type: "HKQuantityTypeIdentifierHeartRate", value: "60", unit: "count/min" }),
      ],
      clock,
    );
    expect(result.healthSummaries?.filter((entry) => entry.type === steps)).toHaveLength(4);
    expect(result.healthSummaries?.some((entry) => entry.type === sleep)).toBe(true);
    expect(result.healthSummaries?.find((entry) => entry.type.endsWith("HeartRate"))).toMatchObject(
      { aggregation: "latest", sampleCount: 1 },
    );
    expect(result.healthObservationCoverage).toHaveLength(HEALTH_METRICS.length);
    expect(
      result.healthObservationCoverage?.find((entry) => entry.type.endsWith("BodyMassIndex"))
        ?.freshness,
    ).toBe("missing");
  });

  it("ignores future, nonnumeric and impossible sleep readings", () => {
    const result = summariseHealthObservations(
      [
        row({ end_at: new Date("2027-06-07T08:00:00Z") }),
        row({ identity: "bad-interval", start_at: new Date("2026-06-01T01:00:00Z") }),
        row({ type: steps, identity: "bad-number", value: "not-a-number" }),
      ],
      clock,
    );
    expect(result.healthSummaries).toEqual([]);
  });

  it("marks otherwise valid source summaries partial when malformed records were excluded", () => {
    const result = summariseHealthObservations(
      [
        row({ type: steps, value: "100", unit: "count" }),
        row({ type: steps, identity: "bad", value: "NaN", unit: "count" }),
      ],
      clock,
    );
    expect(result.healthSummaries?.[0]).toMatchObject({
      value: 100,
      sampleCount: 1,
      coverage: "partial",
    });
    expect(result.healthSummaries?.[0]?.note).toContain("Unusable records were omitted");
  });

  it("binds summary identity and provenance to every contributing record, including after the eighth", () => {
    const heartRows = Array.from({ length: 9 }, (_, index) =>
      row({
        type: "HKQuantityTypeIdentifierHeartRate",
        identity: `synthetic-heart-${index}`,
        value: "60",
        unit: "count/min",
      }),
    );
    const first = summariseHealthObservations(heartRows, clock).healthSummaries?.[0];
    const tenth = row({
      type: "HKQuantityTypeIdentifierHeartRate",
      identity: "synthetic-heart-9",
      value: "120",
      unit: "count/min",
    });
    const appended = summariseHealthObservations([...heartRows, tenth], clock).healthSummaries?.[0];
    const reordered = summariseHealthObservations([tenth, ...heartRows.reverse()], clock)
      .healthSummaries?.[0];
    expect(first).toMatchObject({ value: 60, sampleCount: 9 });
    expect(first?.sourceIds).toHaveLength(9);
    expect(appended).toMatchObject({ value: 66, sampleCount: 10 });
    expect(appended?.sourceIds).toHaveLength(10);
    expect(appended?.sourceIds).toContain("synthetic-heart-9");
    expect(appended?.id).not.toBe(first?.id);
    expect(reordered?.id).toBe(appended?.id);
  });
});

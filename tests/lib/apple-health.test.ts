import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AppleHealthImportError,
  parseAppleHealthXml,
  summarizeHealthObservations,
  type AppleHealthObservation,
} from "@/lib/apple-health";

const DATE = "2026-08-20 10:00:00 -0400";
const END = "2026-08-20 10:05:00 -0400";
const RECORD = `<Record type="HKQuantityTypeIdentifierStepCount" sourceName="Synthetic Watch" sourceVersion="1" device="Synthetic device" unit="count" creationDate="${END}" startDate="${DATE}" endDate="${END}" value="321"/>`;
const document = (inner = RECORD, prefix = "") =>
  `${prefix}<HealthData locale="en_US">${inner}</HealthData>`;

async function* bytes(xml: string, chunk = 31) {
  const data = Buffer.from(xml);
  for (let offset = 0; offset < data.length; offset += chunk)
    yield data.subarray(offset, offset + chunk);
}

async function parse(xml: string, chunk = 31) {
  const observations: AppleHealthObservation[] = [];
  const report = await parseAppleHealthXml(bytes(xml, chunk), async (batch) => {
    observations.push(...batch);
  });
  return { report, observations };
}

describe("private Apple Health XML ingestion", () => {
  it("streams observations with exact value, original offset and canonical timestamps", async () => {
    const xml = document();
    const { report, observations } = await parse(xml, 7);
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      kind: "record",
      type: "HKQuantityTypeIdentifierStepCount",
      value: "321",
      unit: "count",
      sourceName: "Synthetic Watch",
      sourceVersion: "1",
      device: "Synthetic device",
      startAt: "2026-08-20T14:00:00.000Z",
      endAt: "2026-08-20T14:05:00.000Z",
      originalStartAt: DATE,
      originalEndAt: END,
      createdAt: "2026-08-20T14:05:00.000Z",
    });
    expect(report).toMatchObject({
      bytes: Buffer.byteLength(xml),
      records: 1,
      workouts: 0,
      sourceCount: 1,
      fingerprint: createHash("sha256").update(xml).digest("hex"),
      firstObservationAt: "2026-08-20T14:00:00.000Z",
      lastObservationAt: "2026-08-20T14:05:00.000Z",
      types: { HKQuantityTypeIdentifierStepCount: 1 },
      excludedElements: {},
    });
    expect(JSON.stringify(report)).not.toContain("Synthetic");
    expect(JSON.stringify(report)).not.toContain("321");
  });

  it("supports UTF-8 split inside multibyte characters and XML escaped app names", async () => {
    const { observations } = await parse(
      document(RECORD.replace("Synthetic Watch", "Synthetic 🧪 &amp; tracker")),
      1,
    );
    expect(observations[0]?.sourceName).toBe("Synthetic 🧪 & tracker");
  });

  it.each([
    "<!DOCTYPE HealthData>",
    "<!DOCTYPE HealthData [<!ELEMENT HealthData (Record*)><!ELEMENT Record EMPTY><!ATTLIST Record value CDATA #REQUIRED>]>",
  ])("accepts inert Apple DTD form %s", async (doctype) => {
    const result = await parse(
      document(RECORD, `<?xml version="1.0" encoding="UTF-8"?>${doctype}`),
    );
    expect(result.report.records).toBe(1);
  });

  it("supports workout duration and excludes routes and arbitrary metadata", async () => {
    const xml = document(`<Me HKCharacteristicTypeIdentifierDateOfBirth="1900-01-01"/>
      <ExportDate value="${END}"/>
      <Workout workoutActivityType="HKWorkoutActivityTypeWalking" sourceName="Synthetic Watch" duration="5" durationUnit="min" startDate="${DATE}" endDate="${END}">
        <MetadataEntry key="private note" value="DO NOT RETAIN"/>
        <WorkoutRoute><FileReference path="private/route.gpx"/></WorkoutRoute>
        <WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" sum="2"/>
      </Workout><ClinicalRecord><Record value="DO NOT IMPORT NESTED RECORD"/></ClinicalRecord>`);
    const { report, observations } = await parse(xml);
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      kind: "workout",
      type: "HKWorkoutActivityTypeWalking",
      value: "5",
      unit: "min",
    });
    expect(report.excludedElements).toEqual({
      Me: 1,
      ExportDate: 1,
      MetadataEntry: 1,
      WorkoutRoute: 1,
      FileReference: 1,
      WorkoutStatistics: 1,
      ClinicalRecord: 1,
      Other: 1,
    });
    expect(JSON.stringify({ report, observations })).not.toMatch(/DO NOT|route\.gpx|1900-01-01/);
  });

  it("retains category values without interpreting them as measurements", async () => {
    const xml = document(
      RECORD.replace("HKQuantityTypeIdentifierStepCount", "HKCategoryTypeIdentifierSleepAnalysis")
        .replace('unit="count" ', "")
        .replace('value="321"', 'value="HKCategoryValueSleepAnalysisAsleepCore"'),
    );
    const { observations } = await parse(xml);
    expect(observations[0]).toMatchObject({
      unit: null,
      value: "HKCategoryValueSleepAnalysisAsleepCore",
    });
  });

  it("dedupe identity is independent of export framing and app version", async () => {
    const first = await parse(document());
    const repeated = await parse(
      document(RECORD.replace('sourceVersion="1"', 'sourceVersion="2"'), '<?xml version="1.0"?>'),
    );
    const anotherDevice = await parse(
      document(RECORD.replace('device="Synthetic device"', 'device="Synthetic other"')),
    );
    expect(first.observations[0]?.identity).toBe(repeated.observations[0]?.identity);
    expect(first.report.fingerprint).not.toBe(repeated.report.fingerprint);
    expect(first.observations[0]?.identity).not.toBe(anotherDevice.observations[0]?.identity);
  });

  it("normalizes equivalent timestamp offsets for identity", async () => {
    const first = await parse(document());
    const repeated = await parse(document(RECORD.replaceAll(" -0400", "-04:00")));
    expect(first.observations[0]?.identity).toBe(repeated.observations[0]?.identity);
  });

  it.each([
    '<!DOCTYPE HealthData SYSTEM "file:///private/secret">',
    '<!DOCTYPE HealthData PUBLIC "schema" "https://example.test/secret">',
    '<!DOCTYPE HealthData [<!ENTITY secret "private">]>',
    '<!DOCTYPE HealthData [<!ENTITY % remote SYSTEM "https://example.test/secret">%remote;]>',
    "<!DOCTYPE Other>",
    "<?load private-data?>",
  ])("refuses external/entity/processing declarations without echoing contents", async (prefix) => {
    await expect(parse(document(RECORD, prefix))).rejects.toBeInstanceOf(AppleHealthImportError);
    await expect(parse(document(RECORD, prefix))).rejects.not.toThrow(
      /private-data|file:\/\/\/private|https:\/\/example/,
    );
  });

  it.each([
    "<Other/>",
    "<HealthData><Record/></HealthData>",
    "<HealthData></Other>",
    document(RECORD.replace('value="321"', 'value="NaN"')),
    document(RECORD.replace('value="321"', 'value="1e999"')),
    document(RECORD.replace('sourceName="Synthetic Watch"', 'sourceName=""')),
    document(RECORD.replace(DATE, "2026-02-30 10:00:00 -0400")),
    document(RECORD.replace(DATE, "2026-08-20 25:00:00 -0400")),
    document(RECORD.replace(DATE, "2026-08-20 10:00:00 +1500")),
    document(RECORD.replace(DATE, "2026-08-20 10:00:00 +1460")),
    document(RECORD.replace(DATE, "2026-08-20 10:00:00")),
    document(RECORD.replace(DATE, "2026-08-20 11:00:00 -0400")),
    document(RECORD.replace('value="321"', 'value="&custom;"')),
    document(RECORD, '<?xml version="1.0" encoding="UTF-16"?>'),
  ])("rejects malformed, invalid or timezone-free input", async (xml) => {
    await expect(parse(xml)).rejects.toBeInstanceOf(AppleHealthImportError);
  });

  it("rejects invalid UTF-8 without replacement characters", async () => {
    async function* invalid() {
      yield Buffer.from([0xff, 0xfe]);
    }
    await expect(parseAppleHealthXml(invalid(), async () => {})).rejects.toThrow("valid UTF-8");
  });

  it("enforces resource limits", async () => {
    await expect(
      parseAppleHealthXml(bytes(document()), async () => {}, { maxBytes: 10 }),
    ).rejects.toThrow("byte processing limit");
    await expect(
      parseAppleHealthXml(bytes(document(RECORD + RECORD)), async () => {}, { maxObservations: 1 }),
    ).rejects.toThrow("Observation count");
    await expect(parse(document("<Wrapper>".repeat(33) + "</Wrapper>".repeat(33)))).rejects.toThrow(
      "structure",
    );
    await expect(
      parseAppleHealthXml(bytes('<HealthData bad="' + "x".repeat(80_000), 1024), async () => {}, {
        maxTokenCharacters: 100,
      }),
    ).rejects.toThrow("XML token");
    await expect(
      parseAppleHealthXml(bytes(document()), async () => {}, { maxBytes: -1 }),
    ).rejects.toThrow("Invalid Apple Health processing limit");
  });

  it("awaits the sink and propagates failures instead of continuing", async () => {
    let calls = 0;
    await expect(
      parseAppleHealthXml(bytes(document(RECORD + RECORD)), async () => {
        calls += 1;
        throw new Error("Synthetic storage failure");
      }),
    ).rejects.toThrow("Synthetic storage failure");
    expect(calls).toBe(1);
  });

  it("does not return a success report when malformed XML follows staged samples", async () => {
    const staged: AppleHealthObservation[] = [];
    await expect(
      parseAppleHealthXml(bytes(`<HealthData>${RECORD}</Wrong>`), async (batch) => {
        staged.push(...batch);
      }),
    ).rejects.toThrow("Malformed XML");
    expect(staged).toHaveLength(1); // The database sink must roll this transaction back.
  });
});

describe("source-aware health context summaries", () => {
  it("keeps overlapping devices separate and never sums their values", async () => {
    const first = (await parse(document())).observations[0]!;
    const second = (await parse(document(RECORD.replace("Synthetic Watch", "Synthetic Phone"))))
      .observations[0]!;
    const rows = summarizeHealthObservations(
      [first, second, first],
      new Date("2026-08-21T00:00:00Z"),
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.latestValue)).toEqual(["321", "321"]);
    expect(rows.map((row) => row.samplesInInput)).toEqual([1, 1]);
  });

  it("only reports the latest source value, excludes future data, and bounds groups", async () => {
    const old = (await parse(document())).observations[0]!;
    const recent = (
      await parse(
        document(
          RECORD.replaceAll("2026-08-20", "2026-08-21").replace('value="321"', 'value="111"'),
        ),
      )
    ).observations[0]!;
    const future = (await parse(document(RECORD.replaceAll("2026-08-20", "2027-01-01"))))
      .observations[0]!;
    expect(
      summarizeHealthObservations([old, recent, future], new Date("2026-08-22T00:00:00Z"), 1),
    ).toEqual([
      expect.objectContaining({
        latestValue: "111",
        latestEndAt: "2026-08-21T14:05:00.000Z",
        samplesInInput: 2,
      }),
    ]);
    expect(() => summarizeHealthObservations([], new Date("invalid"))).toThrow("summary bounds");
    expect(() => summarizeHealthObservations([], new Date(), 0)).toThrow("summary bounds");
  });
});

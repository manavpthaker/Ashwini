import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AppleHealthClinicalImportError,
  buildAppleHealthClinicalImports,
} from "@/lib/apple-health-clinical";
import { parseHealthContextImport } from "@/lib/health-context";

const code = (display = "Synthetic marker") => ({
  coding: [{ system: "http://loinc.org", code: "synthetic-code", display }],
});
const observation = (overrides: Record<string, unknown> = {}) => ({
  resourceType: "Observation",
  id: "synthetic-resource-id",
  status: "final",
  effectiveDateTime: "2026-08-12T09:00:00-04:00",
  meta: { source: "https://synthetic.example/provider/fhir" },
  code: code(),
  valueQuantity: { value: 8, unit: "mg/dL" },
  ...overrides,
});
const document = (value: unknown) => ({ raw: JSON.stringify(value) });
const build = (...values: unknown[]) => buildAppleHealthClinicalImports(values.map(document));
const entries = (result: ReturnType<typeof build>) =>
  result.imports.flatMap((item) => item.sources.flatMap((source) => source.entries));

describe("structured Apple Health clinical curation", () => {
  it("retains source quantity, ranges and flags without inferring current truth", () => {
    const raw = JSON.stringify(
      observation({
        referenceRange: [{ low: { value: 2, unit: "mg/dL" }, high: { value: 10, unit: "mg/dL" } }],
        interpretation: [code("Synthetic source interpretation")],
        note: [{ text: "PRIVATE NARRATIVE OMITTED" }],
        text: { div: "PRIVATE NARRATIVE OMITTED" },
        subject: { reference: "PRIVATE PATIENT IDENTIFIER" },
      }),
    );
    const result = buildAppleHealthClinicalImports([{ raw }]);
    expect(result.imports).toHaveLength(1);
    const source = result.imports[0]!.sources[0]!;
    expect(source.contentHash).toBe(createHash("sha256").update(raw).digest("hex"));
    expect(source.label).toBe("Apple Health clinical record (Observation)");
    expect(source.entries[0]).toMatchObject({
      category: "measurement",
      sourceDate: "2026-08-12",
      datePrecision: "day",
      temporalStatus: "historical",
      confirmationRequired: false,
    });
    expect(source.entries[0]!.statement).toContain("8 mg/dL");
    expect(source.entries[0]!.statement).toContain("low 2 mg/dL, high 10 mg/dL");
    expect(source.entries[0]!.statement).toContain(
      "Source interpretation: Synthetic source interpretation",
    );
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|synthetic-resource-id/);
    expect(JSON.stringify(result.report)).not.toMatch(/marker|mg\/dL|interpretation/);
    expect(parseHealthContextImport(result.imports[0])).toEqual(result.imports[0]);
  });

  it("supports distinct string, coded, boolean, integer and component results", () => {
    const result = build(
      observation({
        id: "a",
        valueQuantity: undefined,
        valueString: "Synthetic qualitative result",
      }),
      observation({
        id: "b",
        valueQuantity: undefined,
        valueCodeableConcept: code("Synthetic result code"),
      }),
      observation({ id: "c", valueQuantity: undefined, valueBoolean: false }),
      observation({ id: "d", valueQuantity: undefined, valueInteger: 4 }),
      observation({
        id: "e",
        valueQuantity: undefined,
        component: [
          {
            code: code("Synthetic component one"),
            valueQuantity: { value: 1, comparator: "<", code: "mmol/L" },
          },
          { code: code("Synthetic component two"), valueString: "Synthetic component result" },
        ],
      }),
    );
    expect(entries(result)).toHaveLength(6);
    expect(
      entries(result)
        .map((entry) => entry.statement)
        .join(" "),
    ).toContain("<1 mmol/L");
    expect(result.report.includedResources).toBe(5);
  });

  it("does not invent missing units, dates or source-priority meaning", () => {
    const result = build(
      observation({
        effectiveDateTime: undefined,
        issued: "2026-08-13T12:00:00Z",
        meta: { lastUpdated: "2026-08-14T12:00:00Z" },
        valueQuantity: { value: 5 },
      }),
    );
    expect(entries(result)[0]).toMatchObject({
      sourceDate: null,
      datePrecision: "unknown",
      temporalStatus: "uncertain",
      confirmationRequired: true,
    });
    expect(entries(result)[0]!.statement).toContain("unit not supplied");
    expect(result.report.firstRecordDate).toBeNull();
  });

  it.each(["preliminary", undefined])(
    "does not promote %s source observations to confirmed results",
    (status) => {
      const entry = entries(build(observation({ status })))[0]!;
      expect(entry.confirmationRequired).toBe(true);
      expect(entry.statement).toContain("Do not treat this source record as a confirmed result");
    },
  );

  it.each(["entered-in-error", "cancelled"])(
    "retires %s results with a source tombstone, not an evidence value",
    (status) => {
      const previous = observation({
        meta: {
          source: "https://synthetic.example/provider/fhir",
          lastUpdated: "2026-01-01T10:00:00Z",
        },
      });
      const correction = observation({
        status,
        meta: {
          source: "https://synthetic.example/provider/fhir",
          lastUpdated: "2026-02-01T10:00:00Z",
        },
      });
      const result = build(correction, previous);
      expect(result.imports).toHaveLength(2);
      expect(result.imports[0]!.sources[0]!.entries).toHaveLength(1);
      expect(result.imports[1]!.sources[0]!.entries).toEqual([]);
      expect(result.report.retiredObservationResources).toBe(1);
    },
  );

  it("rejects modifier extensions on included resources and nested structures", () => {
    expect(() =>
      build(
        observation({
          modifierExtension: [{ url: "https://synthetic.example/modifier", valueBoolean: true }],
        }),
      ),
    ).toThrow("modifier extension");
    expect(() =>
      build(
        observation({ valueQuantity: { value: 2, modifierExtension: [{ valueBoolean: true }] } }),
      ),
    ).toThrow("modifier extension");
    expect(() => build(observation({ modifierExtension: [] }))).not.toThrow();
    expect(
      build({ resourceType: "Patient", modifierExtension: [{ valueBoolean: true }] }).imports,
    ).toEqual([]);
  });

  it.each([
    ["2024", "2024-01-01", "year"],
    ["2024-02", "2024-02-01", "month"],
    ["2024-02-29", "2024-02-29", "day"],
  ])("preserves source date precision for %s", (input, expected, precision) => {
    expect(entries(build(observation({ effectiveDateTime: input })))[0]).toMatchObject({
      sourceDate: expected,
      datePrecision: precision,
    });
  });

  it("imports clinical labels as dated assertions requiring confirmation", () => {
    const result = build(
      {
        resourceType: "Condition",
        id: "condition",
        code: code("Synthetic condition"),
        recordedDate: "2024-04-03",
        clinicalStatus: code("active"),
        verificationStatus: code("confirmed"),
      },
      {
        resourceType: "Immunization",
        id: "immunization",
        vaccineCode: code("Synthetic vaccine"),
        occurrenceDateTime: "2023-01-02",
        status: "completed",
        lotNumber: "PRIVATE LOT",
      },
      {
        resourceType: "AllergyIntolerance",
        id: "allergy",
        code: code("Synthetic allergen"),
        recordedDate: "2022-01-01",
        clinicalStatus: code("active"),
      },
      {
        resourceType: "Procedure",
        id: "procedure",
        code: code("Synthetic procedure"),
        performedPeriod: { start: "2026-01-04T10:00:00Z", end: "2026-01-04T11:00:00Z" },
        status: "completed",
      },
    );
    expect(entries(result)).toHaveLength(4);
    expect(
      entries(result).every(
        (entry) => entry.confirmationRequired && entry.temporalStatus === "historical",
      ),
    ).toBe(true);
    expect(entries(result).find((entry) => entry.category === "condition")!.statement).toContain(
      "not independently verified current status",
    );
    expect(JSON.stringify(result)).not.toContain("PRIVATE LOT");
    expect(result.report).toMatchObject({
      firstRecordDate: "2022-01-01",
      lastRecordDate: "2026-01-04",
    });
  });

  it("imports medication order fields without narrative dosage or an adherence claim", () => {
    const result = build({
      resourceType: "MedicationRequest",
      id: "medication",
      authoredOn: "2026-01-02",
      status: "active",
      medicationReference: { display: "Synthetic medicine", reference: "PRIVATE MEDICATION LINK" },
      note: [{ text: "PRIVATE NOTE" }],
      dosageInstruction: [
        {
          text: "PRIVATE DOSAGE NARRATIVE",
          asNeededBoolean: true,
          doseAndRate: [{ doseQuantity: { value: 5, unit: "mg" } }],
          timing: { repeat: { frequency: 2, period: 1, periodUnit: "d" } },
        },
      ],
    });
    const entry = entries(result)[0]!;
    expect(entry).toMatchObject({
      category: "medication_history",
      confirmationRequired: true,
      temporalStatus: "historical",
    });
    expect(entry.statement).toContain("Source record status: active");
    expect(entry.statement).toContain("dose 5 mg, frequency 2, per 1 d, as-needed flag true");
    expect(entry.statement).toContain("not confirmation of current use");
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });

  it("excludes documents, demographics and reports without following linked attachments", () => {
    const result = build(
      { resourceType: "Patient", name: [{ text: "PRIVATE NAME" }] },
      {
        resourceType: "DocumentReference",
        content: [
          {
            attachment: {
              url: "https://private.example.test/document",
              data: "PRIVATE ATTACHMENT",
            },
          },
        ],
      },
      { resourceType: "DiagnosticReport", presentedForm: [{ data: "PRIVATE REPORT" }] },
      { resourceType: "UnrecognizedPrivateType", text: "PRIVATE" },
    );
    expect(result.imports).toEqual([]);
    expect(result.report.excludedResources).toEqual({
      Patient: 1,
      DocumentReference: 1,
      DiagnosticReport: 1,
      Other: 1,
    });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|private\.example|UnrecognizedPrivateType/);
  });

  it("deduplicates identical source bytes and distinguishes providers", () => {
    const raw = JSON.stringify(observation());
    const result = buildAppleHealthClinicalImports([
      { raw, providerKey: "one" },
      { raw, providerKey: "one" },
      { raw, providerKey: "two" },
    ]);
    expect(result.report).toMatchObject({
      resources: 3,
      duplicateResources: 1,
      sources: 2,
      entries: 2,
    });
    expect(result.imports[0]!.sources[0]!.key).not.toBe(result.imports[0]!.sources[1]!.key);
    expect(JSON.stringify(result)).not.toMatch(/"one"|"two"/);
  });

  it("uses explicit content-fingerprint identity when FHIR supplies no resource ID", () => {
    const data = {
      resourceType: "Immunization",
      occurrenceDateTime: "2025-01-01",
      status: "completed",
      vaccineCode: { coding: [{ system: "http://hl7.org/fhir/sid/cvx", code: "synthetic" }] },
    };
    const result = build(data, data);
    expect(result.report).toMatchObject({
      resourcesWithoutStableId: 1,
      duplicateResources: 1,
      sources: 1,
    });
    expect(entries(result)[0]!.statement).toContain("CVX: synthetic");
  });

  it("preserves distinct provider tenant paths on the same host", () => {
    const result = build(
      observation({ meta: { source: "https://synthetic.example/provider-a/fhir" } }),
      observation({ meta: { source: "https://synthetic.example/provider-b/fhir" } }),
    );
    expect(result.report.sources).toBe(2);
    expect(result.imports[0]!.sources[0]!.key).not.toBe(result.imports[0]!.sources[1]!.key);
    expect(JSON.stringify(result)).not.toContain("synthetic.example");
  });

  it("keeps ambiguous unscoped IDs distinct while deduplicating exact bytes", () => {
    const first = observation({ meta: undefined });
    const second = observation({ meta: undefined, valueQuantity: { value: 9 } });
    const result = build(first, second, first);
    expect(result.report).toMatchObject({
      resourcesWithoutProvider: 2,
      duplicateResources: 1,
      sources: 2,
    });
    expect(result.imports[0]!.sources[0]!.key).not.toBe(result.imports[0]!.sources[1]!.key);
  });

  it("retains chronologically ordered versions in a stable source namespace", () => {
    const old = observation({
      meta: {
        source: "https://synthetic.example/provider/fhir",
        lastUpdated: "2026-01-01T10:00:00Z",
      },
    });
    const recent = observation({
      meta: {
        source: "https://synthetic.example/provider/fhir",
        lastUpdated: "2026-02-01T10:00:00Z",
      },
    });
    const result = build(recent, old);
    expect(result.imports).toHaveLength(2);
    expect(result.imports[0]!.sources[0]!.key).toBe(result.imports[1]!.sources[0]!.key);
    expect(result.imports[0]!.sources[0]!.contentHash).toBe(
      createHash("sha256").update(JSON.stringify(old)).digest("hex"),
    );
    expect(JSON.stringify(result)).not.toContain("synthetic.example");
  });

  it("refuses ambiguous different versions instead of guessing from archive order", () => {
    expect(() => build(observation(), observation({ valueQuantity: { value: 9 } }))).toThrow(
      "conflicting source versions",
    );
  });

  it("chunks validated sources at 100 without dropping any", () => {
    const result = build(
      ...Array.from({ length: 201 }, (_, index) => observation({ id: `synthetic-${index}` })),
    );
    expect(result.imports.map((item) => item.sources.length)).toEqual([100, 100, 1]);
    expect(result.report.entries).toBe(201);
    result.imports.forEach((item) => expect(parseHealthContextImport(item)).toEqual(item));
  });

  it.each([
    observation({ id: "" }),
    observation({ valueQuantity: { value: "PRIVATE INVALID" } }),
    observation({ valueQuantity: { value: 1, comparator: "?" } }),
    observation({ effectiveDateTime: "2026-02-30" }),
    observation({ effectiveDateTime: "2026-01-01T09:00:00" }),
    observation({ effectiveDateTime: "2026-01-01T24:00:00Z" }),
    observation({ effectiveDateTime: "2026T09:00:00Z" }),
    observation({ effectiveDateTime: "2026-01T09:00:00Z" }),
    observation({ effectiveDateTime: "2026-01-01T10:00:00+14:01" }),
    observation({ code: { text: "PRIVATE\nNARRATIVE" } }),
    observation({ code: { text: "x".repeat(241) } }),
    observation({ valueString: "ambiguous second value" }),
    observation({ valueSampledData: { data: "unsupported" } }),
    observation({ valueQuantity: undefined }),
    observation({ component: {} }),
    observation({ meta: { source: "PRIVATE NOT A URI" } }),
    observation({ valueQuantity: undefined, valueInteger: 1.2 }),
    observation({ valueQuantity: undefined, valueBoolean: "yes" }),
  ])("fails closed on malformed supported fields without echoing content", (value) => {
    expect(() => build(value)).toThrow(AppleHealthClinicalImportError);
    expect(() => build(value)).not.toThrow(/PRIVATE|synthetic-resource-id/);
  });

  it("validates the whole collection before returning any import", () => {
    expect(() =>
      buildAppleHealthClinicalImports([document(observation()), { raw: "PRIVATE INVALID JSON" }]),
    ).toThrow("malformed JSON");
    expect(() => buildAppleHealthClinicalImports([{ raw: new Uint8Array([0xff]) }])).toThrow(
      "invalid UTF-8",
    );
  });

  it("enforces resource, byte, structure, entry and assertion limits", () => {
    expect(() => buildAppleHealthClinicalImports([{ raw: " ".repeat(1024 * 1024 + 1) }])).toThrow(
      "byte limit",
    );
    expect(() =>
      build(...Array.from({ length: 5001 }, () => ({ resourceType: "Patient" }))),
    ).toThrow("resource count");
    expect(() =>
      build(
        ...Array.from({ length: 2001 }, (_, index) => observation({ id: `synthetic-${index}` })),
      ),
    ).toThrow("assertion count");
    let nested: unknown = "synthetic";
    for (let index = 0; index < 25; index++) nested = { child: nested };
    expect(() => build({ resourceType: "Patient", nested })).toThrow("structure limit");
    expect(() =>
      build(
        observation({
          referenceRange: Array.from({ length: 5 }, () => ({ text: "x".repeat(240) })),
        }),
      ),
    ).toThrow("assertion length");
  });
});

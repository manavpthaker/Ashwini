/** Bounded, local-only curation of structured Apple-exported FHIR resources. */
import { createHash } from "node:crypto";
import {
  parseHealthContextImport,
  type HealthContextCategory,
  type HealthContextImport,
  type HealthContextSourceImport,
  type SourceDatePrecision,
} from "./health-context";

type ObjectValue = Record<string, unknown>;
type Dated = { sourceDate: string | null; datePrecision: SourceDatePrecision };

export interface AppleHealthClinicalDocument {
  /** Exact resource bytes, not a stringified/reformatted object. Never logged. */
  raw: string | Uint8Array;
  /** Stable private source namespace when known; it is hashed, never rendered. */
  providerKey?: string;
}

export interface AppleHealthClinicalReport {
  resources: number;
  includedResources: number;
  duplicateResources: number;
  resourcesWithoutStableId: number;
  resourcesWithoutProvider: number;
  retiredObservationResources: number;
  sources: number;
  entries: number;
  resourceTypes: Record<string, number>;
  excludedResources: Record<string, number>;
  firstRecordDate: string | null;
  lastRecordDate: string | null;
}

export class AppleHealthClinicalImportError extends Error {
  constructor(reason: string) {
    super(
      `Invalid Apple Health clinical import: ${reason}. No clinical values are included in this error.`,
    );
    this.name = "AppleHealthClinicalImportError";
  }
}

const INCLUDED = new Set([
  "Observation",
  "Condition",
  "MedicationRequest",
  "Immunization",
  "AllergyIntolerance",
  "Procedure",
]);
const KNOWN_EXCLUDED = new Set([
  "Patient",
  "DocumentReference",
  "DiagnosticReport",
  "Medication",
  "Bundle",
  "Encounter",
  "Organization",
  "Practitioner",
]);
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function fail(reason: string): never {
  throw new AppleHealthClinicalImportError(reason);
}
const object = (value: unknown): ObjectValue => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("expected structured object");
  return value as ObjectValue;
};
const optionalObject = (value: unknown): ObjectValue => (value === undefined ? {} : object(value));
const list = (value: unknown, max = 20): unknown[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max)
    fail("invalid or oversized structured collection");
  return value;
};
const term = (value: unknown, max = 240): string => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    fail("invalid or oversized structured text");
  }
  return value.trim();
};
const optionalTerm = (value: unknown, max = 240): string | null =>
  value === undefined ? null : term(value, max);

/** Only short clinical code labels are read, never a resource's narrative text. */
function concept(value: unknown): string {
  const data = object(value);
  const codes = list(data.coding, 10).map(object);
  const first = codes.find((code) => code.display !== undefined) ?? codes[0];
  const label = first?.display !== undefined ? term(first.display) : optionalTerm(data.text);
  const code = first?.code !== undefined ? term(first.code, 120) : null;
  const namespaces: Record<string, string> = {
    "http://loinc.org": "LOINC",
    "http://snomed.info/sct": "SNOMED CT",
    "http://www.nlm.nih.gov/research/umls/rxnorm": "RxNorm",
    "http://hl7.org/fhir/sid/cvx": "CVX",
  };
  const system = typeof first?.system === "string" ? namespaces[first.system] : undefined;
  if (label)
    return code && code !== label ? `${label} [${system ?? "source code"}: ${code}]` : label;
  if (code) return `${system ?? "Source code"}: ${code}`;
  return fail("clinical code or label missing");
}

function numeric(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) fail("invalid numeric clinical value");
  return String(value);
}

function quantity(value: unknown): string {
  const data = object(value);
  const comparator = optionalTerm(data.comparator, 2);
  if (comparator && !["<", "<=", ">", ">="].includes(comparator))
    fail("unsupported quantity comparator");
  const unit = optionalTerm(data.unit, 80) ?? optionalTerm(data.code, 80);
  return `${comparator ?? ""}${numeric(data.value)}${unit ? ` ${unit}` : " (unit not supplied)"}`;
}

function date(value: unknown): Dated {
  if (value === undefined) return { sourceDate: null, datePrecision: "unknown" };
  const input = term(value, 64);
  if (
    !/^(?:\d{4}(?:-\d{2}(?:-\d{2})?)?|\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:0\d|1[0-3]):[0-5]\d|[+-]14:00))$/.test(
      input,
    )
  )
    fail("invalid clinical date");
  const normalized =
    input.length === 4 ? `${input}-01-01` : input.length === 7 ? `${input}-01` : input.slice(0, 10);
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized)
    fail("invalid clinical date");
  if (input.includes("T") && (input.length < 20 || !Number.isFinite(Date.parse(input))))
    fail("invalid clinical timestamp");
  return {
    sourceDate: normalized,
    datePrecision: input.length === 4 ? "year" : input.length === 7 ? "month" : "day",
  };
}

function recordDate(type: string, data: ObjectValue): Dated {
  const fields: Record<string, string[]> = {
    Observation: ["effectiveDateTime"],
    Condition: ["recordedDate", "onsetDateTime"],
    MedicationRequest: ["authoredOn"],
    Immunization: ["occurrenceDateTime"],
    AllergyIntolerance: ["recordedDate", "onsetDateTime"],
    Procedure: ["performedDateTime"],
  };
  for (const field of fields[type] ?? []) if (data[field] !== undefined) return date(data[field]);
  for (const field of type === "Observation"
    ? ["effectivePeriod"]
    : type === "Procedure"
      ? ["performedPeriod"]
      : []) {
    if (data[field] !== undefined) return date(object(data[field]).start);
  }
  return date(undefined);
}

function sourceStatuses(data: ObjectValue): string {
  const statements: string[] = [];
  if (data.status !== undefined) statements.push(`Source record status: ${term(data.status, 60)}`);
  if (data.clinicalStatus !== undefined)
    statements.push(`Source clinical-status label: ${concept(data.clinicalStatus)}`);
  if (data.verificationStatus !== undefined)
    statements.push(`Source verification label: ${concept(data.verificationStatus)}`);
  return statements.length ? ` ${statements.join(". ")}.` : "";
}

function resultValue(data: ObjectValue): string {
  const supported = [
    "valueQuantity",
    "valueString",
    "valueCodeableConcept",
    "valueBoolean",
    "valueInteger",
  ];
  const fields = Object.keys(data).filter(
    (field) => field.startsWith("value") && data[field] !== undefined,
  );
  if (fields.some((field) => !supported.includes(field)))
    fail("unsupported observation result type");
  if (fields.length !== 1) fail("observation needs exactly one supported result value");
  switch (fields[0]) {
    case "valueQuantity":
      return quantity(data.valueQuantity);
    case "valueString":
      return `Source result text: ${term(data.valueString, 400)}`;
    case "valueCodeableConcept":
      return concept(data.valueCodeableConcept);
    case "valueBoolean":
      if (typeof data.valueBoolean !== "boolean") fail("invalid boolean clinical result");
      return String(data.valueBoolean);
    default:
      if (!Number.isInteger(data.valueInteger)) fail("invalid integer clinical result");
      return numeric(data.valueInteger);
  }
}

function interpretation(data: ObjectValue): string {
  const ranges = list(data.referenceRange, 5)
    .map((value) => {
      const range = object(value);
      const parts: string[] = [];
      if (range.low !== undefined) parts.push(`low ${quantity(range.low)}`);
      if (range.high !== undefined) parts.push(`high ${quantity(range.high)}`);
      // FHIR referenceRange.text is a structured result range, not resource narrative.
      if (range.text !== undefined) parts.push(term(range.text, 240));
      if (range.type !== undefined) parts.push(`type ${concept(range.type)}`);
      if (range.appliesTo !== undefined)
        parts.push(`applies to ${list(range.appliesTo, 5).map(concept).join(", ")}`);
      if (range.age !== undefined) {
        const age = object(range.age);
        parts.push(
          `age range ${age.low !== undefined ? quantity(age.low) : "unspecified"} to ${age.high !== undefined ? quantity(age.high) : "unspecified"}`,
        );
      }
      return parts.join(", ");
    })
    .filter(Boolean);
  const flags = list(data.interpretation, 5).map(concept);
  return `${ranges.length ? ` Source reference range: ${ranges.join("; ")}.` : ""}${flags.length ? ` Source interpretation: ${flags.join("; ")}.` : ""}`;
}

function doseDetails(data: ObjectValue): string {
  const details = list(data.dosageInstruction, 5)
    .map((value) => {
      const dosage = object(value);
      const parts = list(dosage.doseAndRate, 5)
        .map((item) => {
          const dose = object(item);
          return dose.doseQuantity === undefined ? "" : `dose ${quantity(dose.doseQuantity)}`;
        })
        .filter(Boolean);
      const repeat = optionalObject(optionalObject(dosage.timing).repeat);
      if (repeat.frequency !== undefined) parts.push(`frequency ${numeric(repeat.frequency)}`);
      if (repeat.period !== undefined)
        parts.push(
          `per ${numeric(repeat.period)} ${optionalTerm(repeat.periodUnit, 20) ?? "unspecified time unit"}`,
        );
      if (dosage.asNeededBoolean !== undefined) {
        if (typeof dosage.asNeededBoolean !== "boolean") fail("invalid medication as-needed flag");
        parts.push(`as-needed flag ${dosage.asNeededBoolean}`);
      }
      return parts.join(", ");
    })
    .filter(Boolean);
  return details.length
    ? ` Source structured dosage (partial fields, not dosing advice): ${details.join("; ")}.`
    : "";
}

function assertions(
  type: string,
  data: ObjectValue,
): { category: HealthContextCategory; statement: string }[] {
  if (type === "Observation") {
    // Empty versions deliberately retire previous eligible values while keeping
    // source/version provenance. A known-invalid result is not weak evidence.
    if (["entered-in-error", "cancelled"].includes(String(data.status))) return [];
    const label = concept(data.code);
    const values: { label: string; data: ObjectValue }[] = [];
    if (Object.keys(data).some((key) => key.startsWith("value"))) values.push({ label, data });
    for (const component of list(data.component, 20)) {
      const value = object(component);
      values.push({ label: `${label} / ${concept(value.code)}`, data: value });
    }
    if (!values.length) fail("observation has no supported result");
    const finalized = ["final", "amended", "corrected"].includes(String(data.status));
    return values.map((value) => ({
      category: "measurement",
      statement: `${finalized ? "Historical clinical observation" : "Unconfirmed clinical observation record"}: ${value.label}: ${resultValue(value.data)}.${sourceStatuses(data)}${interpretation(value.data)}${finalized ? "" : " Do not treat this source record as a confirmed result."}`,
    }));
  }
  if (type === "MedicationRequest") {
    const medication =
      data.medicationCodeableConcept !== undefined
        ? concept(data.medicationCodeableConcept)
        : term(object(data.medicationReference).display);
    return [
      {
        category: "medication_history",
        statement: `Historical medication order: ${medication}.${sourceStatuses(data)}${doseDetails(data)} Order history is not confirmation of current use, prescription validity, or adherence.`,
      },
    ];
  }
  const config: Record<string, { category: HealthContextCategory; prefix: string; field: string }> =
    {
      Condition: { category: "condition", prefix: "Historical condition record", field: "code" },
      Immunization: {
        category: "care_context",
        prefix: "Historical immunization record",
        field: "vaccineCode",
      },
      AllergyIntolerance: {
        category: "care_context",
        prefix: "Historical allergy/intolerance record",
        field: "code",
      },
      Procedure: { category: "care_context", prefix: "Historical procedure record", field: "code" },
    };
  const configForType = config[type];
  if (!configForType) return fail("unsupported clinical resource");
  return [
    {
      category: configForType.category,
      statement: `${configForType.prefix}: ${concept(data[configForType.field])}.${sourceStatuses(data)} Source labels describe this record, not independently verified current status.`,
    },
  ];
}

/** Reject pathological JSON shapes even when their fields would be excluded. */
function validateShape(root: ObjectValue, rejectModifiers: boolean): void {
  const pending: { value: unknown; depth: number }[] = [{ value: root, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const next = pending.pop()!;
    if (++nodes > 20_000 || next.depth > 24) fail("clinical JSON structure limit exceeded");
    if (next.value && typeof next.value === "object") {
      if (rejectModifiers && !Array.isArray(next.value) && "modifierExtension" in next.value) {
        if (list((next.value as ObjectValue).modifierExtension).length)
          fail("unsupported clinical modifier extension");
      }
      for (const value of Object.values(next.value)) pending.push({ value, depth: next.depth + 1 });
    }
  }
}

/**
 * Validate everything before persistence. Chunks must be applied in returned
 * order to preserve multiple dated versions of the same source record.
 * Report fields contain counts/types/dates only, never patient findings.
 */
export function buildAppleHealthClinicalImports(documents: Iterable<AppleHealthClinicalDocument>): {
  imports: HealthContextImport[];
  report: AppleHealthClinicalReport;
} {
  const report: AppleHealthClinicalReport = {
    resources: 0,
    includedResources: 0,
    duplicateResources: 0,
    resourcesWithoutStableId: 0,
    resourcesWithoutProvider: 0,
    retiredObservationResources: 0,
    sources: 0,
    entries: 0,
    resourceTypes: {},
    excludedResources: {},
    firstRecordDate: null,
    lastRecordDate: null,
  };
  const sources: { source: HealthContextSourceImport; versionAt: string | null }[] = [];
  const seen = new Set<string>();
  let bytes = 0;
  for (const document of documents) {
    if (++report.resources > 5000) fail("resource count limit exceeded");
    const rawBytes = typeof document.raw === "string" ? Buffer.from(document.raw) : document.raw;
    if (!(rawBytes instanceof Uint8Array)) fail("expected clinical JSON bytes");
    bytes += rawBytes.byteLength;
    if (rawBytes.byteLength > 1024 * 1024 || bytes > 16 * 1024 * 1024)
      fail("clinical JSON byte limit exceeded");
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBytes));
    } catch {
      fail("malformed JSON or invalid UTF-8");
    }
    const data = object(parsed);
    const type = term(data.resourceType, 80);
    validateShape(data, INCLUDED.has(type));
    const reportType = INCLUDED.has(type) || KNOWN_EXCLUDED.has(type) ? type : "Other";
    report.resourceTypes[reportType] = (report.resourceTypes[reportType] ?? 0) + 1;
    if (!INCLUDED.has(type)) {
      report.excludedResources[reportType] = (report.excludedResources[reportType] ?? 0) + 1;
      continue;
    }
    const contentHash = hash(rawBytes);
    // FHIR permits resources without an id. Exact bytes then remain the only
    // defensible identity: changed versions cannot be linked automatically.
    const resourceIdentity =
      data.id === undefined ? ["content-sha256", contentHash] : ["resource-id", term(data.id, 200)];
    const meta = optionalObject(data.meta);
    let provider =
      document.providerKey === undefined
        ? "apple-health-export/unknown-provider"
        : term(document.providerKey, 500);
    if (document.providerKey === undefined && meta.source !== undefined) {
      try {
        // One host can serve multiple provider/tenant namespaces. Keep the full
        // URI unless the caller supplies a verified stable provider key.
        provider = new URL(term(meta.source, 1000)).href;
      } catch {
        fail("invalid source provenance URI");
      }
    }
    const unknownProvider = document.providerKey === undefined && meta.source === undefined;
    // Unscoped FHIR ids are not globally unique. Preserve distinct ambiguous
    // resources; only identical bytes deduplicate without a provider namespace.
    const identity = hash(
      JSON.stringify([provider, type, resourceIdentity, unknownProvider ? contentHash : null]),
    );
    const key = `apple-clinical/${identity}`;
    if (seen.has(`${key}/${contentHash}`)) {
      report.duplicateResources++;
      continue;
    }
    seen.add(`${key}/${contentHash}`);
    if (data.id === undefined) report.resourcesWithoutStableId++;
    if (unknownProvider) report.resourcesWithoutProvider++;
    const dated = recordDate(type, data);
    const sourceVersionAt = meta.lastUpdated === undefined ? null : term(meta.lastUpdated, 64);
    if (sourceVersionAt !== null) date(sourceVersionAt);
    const versionAt = sourceVersionAt === null ? null : new Date(sourceVersionAt).toISOString();
    const locator = `apple-health-clinical:${identity}`;
    const entries = assertions(type, data).map((assertion, index) => ({
      key: `entry-${index + 1}`,
      ...assertion,
      sourceLocator: locator,
      ...dated,
      temporalStatus: dated.sourceDate === null ? ("uncertain" as const) : ("historical" as const),
      confirmationRequired:
        type !== "Observation" ||
        dated.sourceDate === null ||
        !["final", "amended", "corrected"].includes(String(data.status)),
    }));
    if (type === "Observation" && !entries.length) report.retiredObservationResources++;
    report.entries += entries.length;
    if (report.entries > 2000) fail("clinical assertion count limit exceeded");
    if (entries.some((entry) => entry.statement.length > 1200))
      fail("clinical assertion length limit exceeded");
    const source: HealthContextSourceImport = {
      key,
      label: `Apple Health clinical record (${type})`,
      locator,
      contentHash,
      revision: 1,
      ...dated,
      entries,
    };
    sources.push({ source, versionAt });
    report.includedResources++;
    if (dated.sourceDate !== null) {
      report.firstRecordDate =
        report.firstRecordDate === null || dated.sourceDate < report.firstRecordDate
          ? dated.sourceDate
          : report.firstRecordDate;
      report.lastRecordDate =
        report.lastRecordDate === null || dated.sourceDate > report.lastRecordDate
          ? dated.sourceDate
          : report.lastRecordDate;
    }
  }
  // A new version supersedes the old source for retrieval. Never guess version
  // precedence from ZIP order when timestamps are missing or indistinguishable.
  const versions = new Map<string, Set<string | null>>();
  for (const { source, versionAt } of sources) {
    const prior = versions.get(source.key);
    if (prior && (versionAt === null || prior.has(null) || prior.has(versionAt)))
      fail("conflicting source versions lack distinct revision dates");
    (prior ?? versions.set(source.key, new Set()).get(source.key)!).add(versionAt);
  }
  sources.sort(
    (a, b) =>
      (a.versionAt ?? "").localeCompare(b.versionAt ?? "") ||
      a.source.key.localeCompare(b.source.key),
  );
  const imports: HealthContextImport[] = [];
  let chunk: HealthContextSourceImport[] = [];
  const flush = () => {
    if (chunk.length)
      imports.push(
        parseHealthContextImport({ version: 1, containsTherapyNarrative: false, sources: chunk }),
      );
    chunk = [];
  };
  for (const { source } of sources) {
    if (chunk.length === 100 || chunk.some((item) => item.key === source.key)) flush();
    chunk.push(source);
  }
  flush();
  report.sources = sources.length;
  return { imports, report };
}

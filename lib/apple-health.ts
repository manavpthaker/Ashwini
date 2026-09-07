import { createHash } from "node:crypto";
import { SaxesParser } from "saxes";

/** Deliberately excludes routes, free text, third-party metadata and demographics. */
export interface AppleHealthObservation {
  identity: string;
  kind: "record" | "workout";
  type: string;
  value: string;
  unit: string | null;
  sourceName: string;
  sourceVersion: string | null;
  device: string | null;
  startAt: string;
  endAt: string;
  originalStartAt: string;
  originalEndAt: string;
  createdAt: string | null;
}

export interface AppleHealthImportReport {
  fingerprint: string;
  bytes: number;
  records: number;
  workouts: number;
  sourceCount: number;
  firstObservationAt: string | null;
  lastObservationAt: string | null;
  types: Record<string, number>;
  /** Unsupported element counts only, never their contents or attributes. */
  excludedElements: Record<string, number>;
}

export class AppleHealthImportError extends Error {}

export interface AppleHealthParseOptions {
  maxBytes?: number;
  maxObservations?: number;
  maxTokenCharacters?: number;
}

const LIMITS = {
  maxBytes: 1024 * 1024 * 1024,
  maxObservations: 5_000_000,
  maxTokenCharacters: 1024 * 1024,
};
const CHUNK_BYTES = 64 * 1024;
const EXCLUDED_ELEMENT_NAMES = new Set([
  "Me",
  "ExportDate",
  "ActivitySummary",
  "ClinicalRecord",
  "Correlation",
  "WorkoutRoute",
  "FileReference",
  "MetadataEntry",
  "WorkoutStatistics",
  "WorkoutEvent",
  "InstantaneousBeatsPerMinute",
]);

function boundedLimit(value: number | undefined, ceiling: number): number {
  const limit = value ?? ceiling;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > ceiling) {
    throw new AppleHealthImportError("Invalid Apple Health processing limit.");
  }
  return limit;
}

function attribute(
  attributes: Record<string, string>,
  name: string,
  required = false,
  maxLength = 256,
): string | null {
  const value = attributes[name]?.trim() || null;
  if ((required && value === null) || (value !== null && value.length > maxLength)) {
    throw new AppleHealthImportError(`Missing or oversized ${name} attribute.`);
  }
  return value;
}

/** Apple timestamps must carry their original offset; never assume the server zone. */
function timestamp(value: string): string {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?\s*(Z|[+-]\d{2}:?\d{2})$/.exec(
      value,
    );
  if (!match) throw new AppleHealthImportError("A health timestamp is missing a valid timezone.");
  const [, year, month, day, hour, minute, second, milliseconds, offset] = match;
  const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    Number(year) < 1900 ||
    calendar.getUTCFullYear() !== Number(year) ||
    calendar.getUTCMonth() !== Number(month) - 1 ||
    calendar.getUTCDate() !== Number(day) ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59
  )
    throw new AppleHealthImportError("A health timestamp is invalid.");
  const zone = offset === "Z" ? "Z" : offset!.replace(/([+-]\d{2}):?(\d{2})/, "$1:$2");
  if (
    zone !== "Z" &&
    (Number(zone.slice(1, 3)) > 14 ||
      Number(zone.slice(4)) > 59 ||
      (Number(zone.slice(1, 3)) === 14 && Number(zone.slice(4)) !== 0))
  ) {
    throw new AppleHealthImportError("A health timestamp has an invalid timezone offset.");
  }
  const parsed = new Date(
    `${year}-${month}-${day}T${hour}:${minute}:${second}.${(milliseconds ?? "0").padEnd(3, "0")}${zone}`,
  );
  if (!Number.isFinite(parsed.getTime()))
    throw new AppleHealthImportError("A health timestamp is invalid.");
  return parsed.toISOString();
}

function observation(
  kind: "record" | "workout",
  attrs: Record<string, string>,
): AppleHealthObservation {
  const type = attribute(attrs, kind === "record" ? "type" : "workoutActivityType", true)!;
  if (!/^HK[A-Za-z0-9]+$/.test(type))
    throw new AppleHealthImportError("Unsupported health type identifier.");
  const value = attribute(attrs, kind === "record" ? "value" : "duration", true)!;
  const unit = attribute(attrs, kind === "record" ? "unit" : "durationUnit");
  if (
    (kind === "workout" || type.startsWith("HKQuantityTypeIdentifier")) &&
    (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) ||
      !Number.isFinite(Number(value)))
  ) {
    throw new AppleHealthImportError("A quantitative health value is not finite numeric data.");
  }
  if (kind === "workout" && (Number(value) < 0 || !unit)) {
    throw new AppleHealthImportError("A workout needs a nonnegative duration and its unit.");
  }
  const originalStartAt = attribute(attrs, "startDate", true)!;
  const originalEndAt = attribute(attrs, "endDate", true)!;
  const startAt = timestamp(originalStartAt);
  const endAt = timestamp(originalEndAt);
  if (endAt < startAt)
    throw new AppleHealthImportError("A health observation ends before it starts.");
  const originalCreated = attribute(attrs, "creationDate");
  const data = {
    kind,
    type,
    value,
    unit,
    sourceName: attribute(attrs, "sourceName", true)!,
    sourceVersion: attribute(attrs, "sourceVersion", false, 128),
    device: attribute(attrs, "device", false, 4096),
    startAt,
    endAt,
    originalStartAt,
    originalEndAt,
    createdAt: originalCreated ? timestamp(originalCreated) : null,
  };
  // Export date/path and sourceVersion are not sample identity. Canonical instants
  // also avoid duplicate samples when the same offset is formatted differently.
  const identity = createHash("sha256")
    .update(
      JSON.stringify([
        kind,
        type,
        value,
        unit,
        data.sourceName,
        data.device,
        startAt,
        endAt,
        data.createdAt,
      ]),
    )
    .digest("hex");
  return { identity, ...data };
}

/**
 * Strict, bounded UTF-8 streaming parser. Awaited sinks provide backpressure.
 * A sink must stage writes transactionally: later malformed XML invalidates all
 * preceding observations. No custom entities are registered or resolved.
 */
export async function parseAppleHealthXml(
  chunks: AsyncIterable<Uint8Array>,
  onObservations: (observations: readonly AppleHealthObservation[]) => Promise<void>,
  options: AppleHealthParseOptions = {},
): Promise<AppleHealthImportReport> {
  const maxBytes = boundedLimit(options.maxBytes, LIMITS.maxBytes);
  const maxObservations = boundedLimit(options.maxObservations, LIMITS.maxObservations);
  const maxToken = boundedLimit(options.maxTokenCharacters, LIMITS.maxTokenCharacters);
  const digest = createHash("sha256");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parser = new SaxesParser({ xmlns: false });
  const report: AppleHealthImportReport = {
    fingerprint: "",
    bytes: 0,
    records: 0,
    workouts: 0,
    sourceCount: 0,
    firstObservationAt: null,
    lastObservationAt: null,
    types: Object.create(null) as Record<string, number>,
    excludedElements: Object.create(null) as Record<string, number>,
  };
  const sources = new Set<string>();
  let depth = 0;
  let rootSeen = false;
  let tokenCharacters = 0;
  let elements = 0;
  let typeCount = 0;
  let pending: AppleHealthObservation[] = [];
  const completeToken = () => {
    tokenCharacters = 0;
  };
  parser.on("error", () => {
    throw new AppleHealthImportError("Malformed XML; no import can be committed.");
  });
  parser.on("doctype", (doctype) => {
    completeToken();
    // Apple exports may include their internal ELEMENT/ATTLIST schema. It is
    // inert here. External references and every entity declaration are refused.
    if (
      !/^\s*HealthData(?:\s*\[[\s\S]*\])?\s*$/.test(doctype) ||
      /\b(?:SYSTEM|PUBLIC)\b|<!ENTITY|%/i.test(doctype)
    ) {
      throw new AppleHealthImportError("External or entity-bearing XML declarations are refused.");
    }
  });
  parser.on("opentag", (tag) => {
    completeToken();
    depth += 1;
    elements += 1;
    if (depth > 32 || elements > 20_000_000)
      throw new AppleHealthImportError("XML structure exceeds the processing limit.");
    if (depth === 1) {
      if (rootSeen || tag.name !== "HealthData")
        throw new AppleHealthImportError("Expected one HealthData root element.");
      rootSeen = true;
      if (parser.xmlDecl.encoding && !/^utf-?8$/i.test(parser.xmlDecl.encoding)) {
        throw new AppleHealthImportError("Only UTF-8 Health exports are supported.");
      }
      return;
    }
    if (depth === 2 && (tag.name === "Record" || tag.name === "Workout")) {
      const item = observation(tag.name === "Record" ? "record" : "workout", tag.attributes);
      report[item.kind === "record" ? "records" : "workouts"] += 1;
      if (report.records + report.workouts > maxObservations)
        throw new AppleHealthImportError("Observation count exceeds the processing limit.");
      if (report.types[item.type] === undefined) typeCount += 1;
      report.types[item.type] = (report.types[item.type] ?? 0) + 1;
      sources.add(item.sourceName);
      if (sources.size > 10_000 || typeCount > 10_000)
        throw new AppleHealthImportError("Source or type count exceeds the processing limit.");
      if (!report.firstObservationAt || item.startAt < report.firstObservationAt)
        report.firstObservationAt = item.startAt;
      if (!report.lastObservationAt || item.endAt > report.lastObservationAt)
        report.lastObservationAt = item.endAt;
      pending.push(item);
    } else {
      // Do not retain arbitrary tag names in logs: this bounded allowlist also
      // makes excluded routes, clinical records and metadata visible by category.
      const category = EXCLUDED_ELEMENT_NAMES.has(tag.name) ? tag.name : "Other";
      report.excludedElements[category] = (report.excludedElements[category] ?? 0) + 1;
    }
  });
  parser.on("closetag", () => {
    completeToken();
    depth -= 1;
  });
  parser.on("text", completeToken);
  parser.on("comment", completeToken);
  parser.on("cdata", completeToken);
  parser.on("processinginstruction", () => {
    throw new AppleHealthImportError("XML processing instructions are refused.");
  });

  async function write(bytes: Uint8Array): Promise<void> {
    report.bytes += bytes.byteLength;
    if (report.bytes > maxBytes)
      throw new AppleHealthImportError("Export exceeds the byte processing limit.");
    digest.update(bytes);
    let text: string;
    try {
      text = decoder.decode(bytes, { stream: true });
    } catch {
      throw new AppleHealthImportError("Export is not valid UTF-8.");
    }
    tokenCharacters += text.length;
    if (tokenCharacters > maxToken + CHUNK_BYTES)
      throw new AppleHealthImportError("XML token exceeds the processing limit.");
    parser.write(text);
    if (pending.length) {
      const batch = pending;
      pending = [];
      await onObservations(batch);
    }
  }
  for await (const incoming of chunks) {
    for (let offset = 0; offset < incoming.byteLength; offset += CHUNK_BYTES) {
      await write(incoming.subarray(offset, offset + CHUNK_BYTES));
    }
  }
  try {
    parser.write(decoder.decode()).close();
  } catch (error) {
    if (error instanceof AppleHealthImportError) throw error;
    throw new AppleHealthImportError("Export ended with invalid UTF-8 or XML.");
  }
  if (!rootSeen) throw new AppleHealthImportError("No HealthData document found.");
  report.fingerprint = digest.digest("hex");
  report.sourceCount = sources.size;
  return report;
}

export interface HealthObservationSummary {
  type: string;
  unit: string | null;
  sourceName: string;
  device: string | null;
  latestValue: string;
  latestStartAt: string;
  latestEndAt: string;
  samplesInInput: number;
}

/** Latest per source/type/unit only: no cross-device summation or diagnosis. */
export function summarizeHealthObservations(
  observations: readonly AppleHealthObservation[],
  asOf: Date,
  limit = 20,
): HealthObservationSummary[] {
  if (
    !Number.isFinite(asOf.getTime()) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw new AppleHealthImportError("Invalid health summary bounds.");
  }
  const groups = new Map<string, HealthObservationSummary>();
  const seen = new Set<string>();
  for (const item of observations) {
    if (seen.has(item.identity) || item.endAt > asOf.toISOString()) continue;
    seen.add(item.identity);
    const key = JSON.stringify([item.type, item.unit, item.sourceName, item.device]);
    const previous = groups.get(key);
    if (!previous)
      groups.set(key, {
        type: item.type,
        unit: item.unit,
        sourceName: item.sourceName,
        device: item.device,
        latestValue: item.value,
        latestStartAt: item.startAt,
        latestEndAt: item.endAt,
        samplesInInput: 1,
      });
    else {
      previous.samplesInInput += 1;
      if (item.endAt > previous.latestEndAt) {
        previous.latestValue = item.value;
        previous.latestStartAt = item.startAt;
        previous.latestEndAt = item.endAt;
      }
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.latestEndAt.localeCompare(a.latestEndAt))
    .slice(0, limit);
}

import { describe, expect, it } from "vitest";
import { parseHealthContextImport } from "@/lib/health-context";
import { healthContextPayloadHash } from "@/lib/health-context-import";

function fixture() {
  return {
    version: 1,
    containsTherapyNarrative: false,
    sources: [
      {
        key: "synthetic-history",
        label: "Synthetic source",
        locator: "synthetic.md",
        contentHash: "a".repeat(64),
        sourceDate: "2025-01-01",
        datePrecision: "year",
        entries: [
          {
            key: "goal",
            category: "goal",
            statement: "The synthetic owner wanted a repeatable walking routine.",
            sourceLocator: "synthetic.md#goals",
            sourceDate: "2025-01-01",
            datePrecision: "year",
            temporalStatus: "historical",
            confirmationRequired: true,
          },
        ],
      },
    ],
  };
}

describe("curated private health-context import", () => {
  it("retains uncertainty, source precision and provenance without activating a schedule", () => {
    const parsed = parseHealthContextImport(fixture());
    expect(parsed.sources[0]?.revision).toBe(1);
    expect(parsed.sources[0]?.entries[0]).toMatchObject({
      temporalStatus: "historical",
      confirmationRequired: true,
      datePrecision: "year",
      sourceLocator: "synthetic.md#goals",
    });
  });

  it("requires explicit therapy-narrative exclusion and refuses raw document fields", () => {
    expect(() =>
      parseHealthContextImport({ ...fixture(), containsTherapyNarrative: true }),
    ).toThrow(/Invalid/);
    expect(() => parseHealthContextImport({ ...fixture(), rawDocument: "sensitive body" })).toThrow(
      /Invalid/,
    );
    const payload = fixture();
    delete (payload as { containsTherapyNarrative?: boolean }).containsTherapyNarrative;
    expect(() => parseHealthContextImport(payload)).toThrow(/Invalid/);
  });

  it.each(["medication_history", "supplement_history"])(
    "requires confirmation for %s",
    (category) => {
      const payload = fixture();
      const entry = payload.sources[0]!.entries[0]!;
      entry.category = category;
      entry.confirmationRequired = false;
      expect(() => parseHealthContextImport(payload)).toThrow(/Invalid/);
      entry.confirmationRequired = true;
      expect(parseHealthContextImport(payload).sources).toHaveLength(1);
    },
  );

  it.each([
    ["2025-02-30", "day"],
    ["2025-02-01", "year"],
    ["2025-02-02", "month"],
    ["2025-01-01", "unknown"],
    [null, "day"],
  ])("rejects source date %s with precision %s", (sourceDate, datePrecision) => {
    const payload = fixture();
    Object.assign(payload.sources[0]!.entries[0]!, { sourceDate, datePrecision });
    expect(() => parseHealthContextImport(payload)).toThrow(/Invalid/);
  });

  it("accepts unknown dates without inventing an import-date event", () => {
    const payload = fixture();
    Object.assign(payload.sources[0]!.entries[0]!, { sourceDate: null, datePrecision: "unknown" });
    expect(parseHealthContextImport(payload).sources[0]?.entries[0]?.sourceDate).toBeNull();
  });

  it("refuses duplicate source keys and assertion keys", () => {
    const payload = fixture();
    payload.sources.push(payload.sources[0]!);
    expect(() => parseHealthContextImport(payload)).toThrow(/Invalid/);
    payload.sources.pop();
    payload.sources[0]!.entries.push(payload.sources[0]!.entries[0]!);
    expect(() => parseHealthContextImport(payload)).toThrow(/Invalid/);
  });

  it("does not echo a rejected health statement into validation errors", () => {
    const payload = fixture();
    payload.sources[0]!.entries[0]!.statement = "private-token".repeat(200);
    expect(() => parseHealthContextImport(payload)).toThrow(/^Invalid health-context import\./);
    try {
      parseHealthContextImport(payload);
    } catch (error) {
      expect(String(error)).not.toContain("private-token");
    }
  });

  it("allows an empty source revision to retire previous assertions", () => {
    const payload = fixture();
    payload.sources[0]!.entries = [];
    expect(parseHealthContextImport(payload).sources[0]?.entries).toEqual([]);
  });

  it("ignores entry ordering for idempotency but binds curation changes", () => {
    const source = parseHealthContextImport(fixture()).sources[0]!;
    const first = source.entries[0]!;
    const second = { ...first, key: "second", statement: "A different synthetic assertion." };
    expect(healthContextPayloadHash({ ...source, entries: [first, second] })).toBe(
      healthContextPayloadHash({ ...source, entries: [second, first] }),
    );
    expect(healthContextPayloadHash(source)).not.toBe(
      healthContextPayloadHash({ ...source, revision: 2 }),
    );
  });
});

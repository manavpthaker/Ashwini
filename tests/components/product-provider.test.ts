import { describe, expect, it } from "vitest";
import { mergeRecords } from "@/components/product/product-provider";
import type { CheckinRecord } from "@/lib/product-model";

function record(id: string, headline: string, recordedAt: string): CheckinRecord {
  return { id, recordedAt, originalInput: "Synthetic check-in", time: "12:00", modality: "text", response: { kind: "record", status: "Recorded", gate: "Caveated", headline, acknowledgement: "", interpretation: "", recommendation: headline, receipt: "Saved", recorded: [], perspectives: [], effects: {} } };
}

describe("late history reads", () => {
  it("cannot replace a newer POST result or resurrect its older response", () => {
    const older = record("same", "Older history response", "2026-09-07T12:00:00Z");
    const saved = record("same", "Confirmed POST response", "2026-09-07T12:00:00Z");
    const earlier = record("earlier", "Earlier record", "2026-09-06T12:00:00Z");
    const newest = record("newest", "New saved check-in", "2026-09-07T12:01:00Z");
    const result = mergeRecords([older, earlier], [saved, newest]);
    expect(result.map((item) => item.id)).toEqual(["earlier", "same", "newest"]);
    expect(result[1]?.response.headline).toBe("Confirmed POST response");
    expect(result.filter((item) => item.id === "same")).toHaveLength(1);
  });
});

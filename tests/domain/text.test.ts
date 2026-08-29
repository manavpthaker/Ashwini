import { describe, expect, it } from "vitest";
import { agreeingVerb, formatList } from "@/domain/text";

describe("formatList", () => {
  it("returns the fallback when there is nothing to name", () => {
    // Reached when a caller has an empty set — e.g. a pharmacist handoff with
    // no medication resolved by name.
    expect(formatList([], "your medications")).toBe("your medications");
    expect(formatList([], "these items")).toBe("these items");
  });

  it("returns a single item unchanged", () => {
    expect(formatList(["creatine"], "these items")).toBe("creatine");
  });

  it("joins two with 'and' and no comma", () => {
    expect(formatList(["creatine", "magnesium"], "these items")).toBe("creatine and magnesium");
  });

  it("uses a serial comma for three or more", () => {
    expect(formatList(["a", "b", "c"], "x")).toBe("a, b, and c");
    expect(formatList(["a", "b", "c", "d"], "x")).toBe("a, b, c, and d");
  });
});

describe("agreeingVerb", () => {
  it("agrees with the list length", () => {
    expect(agreeingVerb(1)).toBe("is");
    expect(agreeingVerb(0)).toBe("are");
    expect(agreeingVerb(3)).toBe("are");
  });
});

import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/safe-next";

describe("safeNextPath", () => {
  it("keeps normalized same-origin paths", () => {
    expect(safeNextPath("/plan?from=login#current")).toBe("/plan?from=login#current");
    expect(safeNextPath("/check-in")).toBe("/check-in");
  });

  it.each([
    "//attacker.example",
    "/\\attacker.example",
    "/%5c%5cattacker.example",
    "/%2e%2e//attacker.example",
    "https://attacker.example",
    "javascript:alert(1)",
    "",
  ])("rejects an external or ambiguous target: %s", (target) => {
    expect(safeNextPath(target)).toBeNull();
  });
});

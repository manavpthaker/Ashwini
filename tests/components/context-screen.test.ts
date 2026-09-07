/// <reference types="next" />

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import { ContextScreen, sourceDateLabel } from "@/components/product/context-screen";

describe("health-context source presentation", () => {
  it("does not invent a day for month/year precision or an absent date", () => {
    expect(sourceDateLabel({ sourceDate: null, sourceDatePrecision: "unknown" })).toBe("Source date unknown");
    expect(sourceDateLabel({ sourceDate: "2024-01-01", sourceDatePrecision: "year" })).toBe("2024");
    expect(sourceDateLabel({ sourceDate: "2024-04-01", sourceDatePrecision: "month" })).toBe("Apr 2024");
    expect(sourceDateLabel({ sourceDate: "2024-04-12", sourceDatePrecision: "day" })).toBe("Apr 12, 2024");
  });

  it("starts with unavailable history and an explicit disabled import action, never a fabricated profile", () => {
    const html = renderToStaticMarkup(createElement(ContextScreen));
    expect(html).toContain("Loading your saved history");
    expect(html).toContain("Import health context");
    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).toContain("Status not yet available");
    expect(html).not.toContain("61 saved details");
    expect(html).toContain('id="page-title"');
  });
});

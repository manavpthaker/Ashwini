import { describe, expect, it } from "vitest";
import {
  decodeAdvisorReplyMetadata,
  encodeAdvisorReplyMetadata,
} from "@/lib/advisor-reply-metadata";
import type { AdvisorOutput } from "@/domain/advisor/types";

describe("durable advisor replay metadata", () => {
  it.each([
    {
      followUp: "Which upcoming meal is hardest to make consistent?",
      trace: { ruleId: "contextual-nutrition", mode: "rules_only", reason: "not_configured" },
    },
    {
      followUp: null,
      trace: { ruleId: "contextual-focus", mode: "model_unavailable", reason: "timeout" },
    },
    { followUp: "What changed?", trace: { ruleId: "contextual-synthesis", mode: "model" } },
    { followUp: null, trace: { ruleId: "urgent-symptoms" } },
  ] satisfies Pick<AdvisorOutput, "followUp" | "trace">[])(
    "round trips the exact generated fields %#",
    (output) => {
      const stored = JSON.parse(encodeAdvisorReplyMetadata(output));
      expect(stored.version).toBe(1);
      expect(decodeAdvisorReplyMetadata(stored, output.trace.ruleId)).toEqual(output);
    },
  );

  it.each([null, undefined])("preserves the known legacy representation for %s", (value) => {
    expect(decodeAdvisorReplyMetadata(value, "legacy-rule")).toEqual({
      followUp: null,
      trace: { ruleId: "legacy-rule" },
    });
  });

  it.each([
    {},
    { version: 2, followUp: null, trace: { ruleId: "rule" } },
    { version: 1, followUp: null, trace: { ruleId: "different-rule" } },
    { version: 1, followUp: null, trace: { ruleId: "rule", mode: "invented_mode" } },
    { version: 1, followUp: null, trace: { ruleId: "rule", reason: "PRIVATE_PROVIDER_ERROR" } },
    { version: 1, followUp: null, trace: { ruleId: "rule" }, rawText: "PRIVATE_RAW_CHECKIN" },
    { version: 1, followUp: "x".repeat(251), trace: { ruleId: "rule" } },
  ])("fails closed for malformed, expanded or mismatched stored metadata %#", (value) => {
    expect(() => decodeAdvisorReplyMetadata(value, "rule")).toThrow(
      "The stored advisor reply metadata is invalid and cannot be replayed.",
    );
  });

  it("rejects expanded diagnostics at encoding instead of persisting raw error fields", () => {
    const output = {
      followUp: null,
      trace: { ruleId: "rule", rawError: "PRIVATE_PROVIDER_ERROR" },
    };
    expect(() => encodeAdvisorReplyMetadata(output)).toThrow(
      "Advisor reply metadata does not match the durable contract.",
    );
  });
});

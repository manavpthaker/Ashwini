import { describe, expect, test } from "vitest";
import {
  decisionControlCopy,
  latestRecordedDecisionResponse,
} from "@/components/product/decision-control";
import type { OpenDecision } from "@/lib/record-client";
import type { CheckinRecord } from "@/lib/product-model";

const decision = (over: Partial<OpenDecision> = {}): OpenDecision => ({
  decisionId: "00000000-0000-4000-8000-000000000001",
  createdAt: "2026-08-30T15:00:00.000Z",
  type: "recommendation",
  domain: "training",
  evidenceStatus: "rule_based",
  ladderLevel: 2,
  confidenceNote: "Based on the current record.",
  gateOutcome: "caveated",
  gateReason: "Current self-report only.",
  target: "Choose what happens next",
  expectedLag: "Today",
  choices: [],
  refused: "No diagnosis.",
  expiresAt: null,
  route: null,
  ruleId: "test",
  advisorVersion: "test-1",
  reply: { text: "Saved prompt", receipt: "Saved" },
  sourceMessageId: "00000000-0000-4000-8000-000000000002",
  ...over,
});

describe("decision control language", () => {
  test("does not describe a data-quality block as a provider handoff", () => {
    const copy = decisionControlCopy(decision({ type: "data_quality_block" }));

    expect(copy.heading).toMatch(/evidence gap/i);
    expect(copy.description).toMatch(/missing or unusable/i);
    expect(copy.description).not.toMatch(/contact the named professional/i);
  });

  test("states that acknowledging a route sends nothing and resolves nothing", () => {
    const copy = decisionControlCopy(
      decision({ type: "route_out", route: "clinician" }),
    );

    expect(copy.heading).toMatch(/care boundary/i);
    expect(copy.description).toMatch(/does not send a handoff/i);
    expect(copy.description).toMatch(/does not .*mark .*resolved/i);
  });

  test("keeps offered choices as durable responses", () => {
    const copy = decisionControlCopy(decision({ choices: ["Reduce volume", "Do nothing"] }));

    expect(copy.heading).toMatch(/choose the response/i);
    expect(copy.description).toMatch(/remains visible/i);
  });
});

describe("completed decision continuity", () => {
  const checkin = (
    id: string,
    respondedAt: string,
    correctionOf?: string,
  ): CheckinRecord => ({
    id,
    recordedAt: "2026-08-30T12:00:00.000Z",
    time: "8:00 AM",
    originalInput: id,
    modality: "text",
    ...(correctionOf ? { correctionOf } : {}),
    response: {
      kind: "recommendation",
      status: "Rule-based",
      gate: "Caveated",
      headline: id,
      acknowledgement: "",
      interpretation: "",
      recommendation: "",
      receipt: "Saved",
      decision: {
        id: `decision-${id}`,
        choices: [id],
        selectedChoice: id,
        respondedAt,
      },
      recorded: [],
      perspectives: [],
      effects: {},
    },
  });

  test("uses response time rather than check-in order", () => {
    const laterCheckin = checkin("later check-in", "2026-08-30T14:00:00.000Z");
    const laterResponse = checkin("later response", "2026-08-30T16:00:00.000Z");

    expect(latestRecordedDecisionResponse([laterResponse, laterCheckin])?.id).toBe(
      "later response",
    );
  });

  test("does not surface a response superseded by a correction", () => {
    const original = checkin("original", "2026-08-30T16:00:00.000Z");
    const correction = checkin(
      "correction",
      "2026-08-30T15:00:00.000Z",
      "original",
    );

    expect(latestRecordedDecisionResponse([original, correction])?.id).toBe("correction");
  });
});

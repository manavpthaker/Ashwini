import { describe, expect, test } from "vitest";
import {
  checkinFailureNotice,
  correctionDraft,
  hasCorrectionChange,
} from "@/components/product/checkin-ux";
import { ConversationError } from "@/lib/checkin-client";
import type { CheckinRecord } from "@/lib/product-model";

const record: CheckinRecord = {
  id: "00000000-0000-4000-8000-000000000001",
  recordedAt: "2026-08-30T15:00:00.000Z",
  time: "11:00 AM",
  originalInput: "I ate lunch",
  modality: "text",
  response: {
    kind: "follow-up",
    status: "Recorded",
    gate: "Clear",
    headline: "Add one meal detail",
    acknowledgement: "",
    interpretation: "Only the occurrence is known.",
    recommendation: "What did you eat?",
    receipt: "Meal occurrence recorded",
    recorded: [],
    perspectives: [],
    effects: {},
  },
};

describe("check-in correction UX", () => {
  test("edits the original wording without persisting an internal correction label", () => {
    expect(correctionDraft(record)).toBe("I ate lunch");
    expect(correctionDraft(record, true)).toBe("I ate lunch — ");
    expect(correctionDraft(record, true)).not.toMatch(/^correction:/i);
  });

  test("requires an actual edit or added detail before saving a correction", () => {
    expect(hasCorrectionChange("I ate lunch", record, false)).toBe(false);
    expect(hasCorrectionChange("I ate lunch — ", record, true)).toBe(false);
    expect(hasCorrectionChange("I ate lunch — eggs and toast", record, true)).toBe(true);
    expect(hasCorrectionChange("I ate breakfast", record, false)).toBe(true);
  });

  test("turns a correction conflict into a specific refreshed-record recovery", () => {
    const notice = checkinFailureNotice(
      new ConversationError("That record has already been superseded.", 409),
    );

    expect(notice).toMatch(/already been superseded/i);
    expect(notice).toMatch(/record has been refreshed/i);
    expect(notice).toMatch(/new check-in/i);
  });

  test("keeps an uncertain write explicitly retryable", () => {
    const notice = checkinFailureNotice(
      new ConversationError("The check-in record is temporarily unavailable.", 503),
    );

    expect(notice).toMatch(/retry the unchanged draft/i);
    expect(notice).toMatch(/without creating a duplicate/i);
  });
});

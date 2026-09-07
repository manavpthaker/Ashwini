import { describe, expect, it } from "vitest";
import { createRulesAdvisor } from "@/domain/advisor";
import { immediateSafetyResponse, preflightContext } from "@/server/checkin-preflight";
import { advisorInput, sertraline, lisinopril } from "../domain/advisor/support";

describe("context-independent safety preflight", () => {
  it.each([
    ["I want to kill myself", "crisis"],
    ["I have chest pain and can't breathe", "urgent-symptoms"],
    ["I fell and cannot lift my arm", "musculoskeletal-red-flag"],
    ["I am pregnant and want to change my workouts", "pregnancy"],
    ["the mole on my back looks different", "skin-lesion"],
    ["My therapist said something upsetting and I have chest pain", "urgent-symptoms"],
  ])("keeps the full safety result for %s without chart reads", async (text, ruleId) => {
    const input = advisorInput(text, preflightContext());
    const result = immediateSafetyResponse(input);
    expect(result?.trace.ruleId).toBe(ruleId);
    expect(result).toEqual(
      await createRulesAdvisor().respond({
        ...input,
        context: { ...input.context, medications: [sertraline, lisinopril] },
      }),
    );
  });

  it.each([
    "What do my sleep records suggest?",
    "I feel tired today",
    "I do not have chest pain",
    "What if I ever develop a mole?",
    "Can I take lisinopril with ibuprofen?",
    "Should I change my prescription dose?",
    "My therapist said I should talk about my childhood",
  ])("leaves %s to the full-context pipeline", (text) => {
    expect(immediateSafetyResponse(advisorInput(text))).toBeNull();
  });
});

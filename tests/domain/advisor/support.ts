import type { ConfoundDefinition, ConfoundEvaluation } from "@/domain/gate";
import type { AdvisorInput, SubjectContext } from "@/domain/advisor";

export const NOW = new Date("2025-06-27T12:18:00Z");

export function subjectContext(overrides: Partial<SubjectContext> = {}): SubjectContext {
  return {
    mealsToday: [],
    commitments: [],
    activeRoutines: [],
    medications: [],
    supplements: [],
    interactionResults: [],
    confoundDefinitions: [],
    confoundEvaluations: [],
    ...overrides,
  };
}

export function advisorInput(text: string, context: Partial<SubjectContext> = {}): AdvisorInput {
  return {
    now: NOW,
    utterance: { text, attachments: [] },
    context: subjectContext(context),
  };
}

export const sertraline = {
  name: "sertraline",
  aliases: ["zoloft"],
  isPrescription: true,
} as const;

export const lisinopril = {
  name: "lisinopril",
  aliases: [],
  isPrescription: true,
} as const;

export function blockingConfound(overrides: Partial<ConfoundDefinition> = {}): ConfoundDefinition {
  return {
    id: "illness",
    label: "Illness",
    domains: ["training", "nutrition", "medication", "body", "focus", "system"],
    blocking: true,
    requiredForVerdict: false,
    threshold: {},
    version: "2025-06-01",
    ...overrides,
  };
}

export const present = (id: string): ConfoundEvaluation => ({ confoundId: id, state: "present" });
export const absent = (id: string): ConfoundEvaluation => ({ confoundId: id, state: "absent" });

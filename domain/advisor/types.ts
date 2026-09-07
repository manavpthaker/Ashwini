/**
 * The advisor contract.
 *
 * This is the seam a model implementation drops into later. It is deliberately
 * async even though RulesAdvisor is synchronous, so swapping in a ModelAdvisor
 * changes no call site.
 *
 * The advisor is pure: it never fetches. Everything it needs arrives in
 * SubjectContext, already materialised by the server. That is what makes the
 * whole safety layer unit-testable without a database.
 */

import type { Domain } from "../domains";
import type { ConfoundCheck } from "../gate";
import type { EvidenceStatus, GateOutcome, LadderLevel } from "../evidence";

export type MessageKind = "record" | "recommendation" | "question" | "route";

export type DecisionType =
  "recommendation" | "data_quality_block" | "scheduled_review" | "route_out";

export type RouteDestination =
  "emergency" | "crisis_line" | "clinician" | "pharmacist" | "prescriber" | "dermatologist";

export interface AttachmentRef {
  readonly kind: "image" | "document";
  readonly storagePath: string;
  readonly mimeType: string;
}

export interface Utterance {
  readonly text: string;
  readonly attachments: readonly AttachmentRef[];
}

export interface MedicationSummary {
  readonly name: string;
  /** Lowercased alternatives the user might type: brand names, abbreviations. */
  readonly aliases: readonly string[];
  readonly isPrescription: boolean;
}

export interface ExternalResultSummary {
  readonly provider: string;
  readonly items: readonly string[];
  readonly checkedAt: Date;
  readonly expiresAt: Date | null;
  readonly evidenceGrade: string | null;
  readonly summary: string;
}

export interface MealSummary {
  readonly kind: "breakfast" | "lunch" | "dinner" | "snack";
  readonly at: Date;
}

export interface Commitment {
  readonly title: string;
  readonly domain: Domain;
  readonly startsAt: Date;
}

export interface RoutineSummary {
  readonly id: string;
  readonly name: string;
  readonly domain: Domain;
  readonly status: EvidenceStatus;
}

/**
 * Everything the advisor is allowed to reason from. If a rule needs a fact,
 * it belongs here — a rule reaching for anything else is a bug.
 */
export interface SubjectContext {
  readonly healthObservations?: readonly {
    readonly id: string;
    readonly type: string;
    readonly unit: string | null;
    readonly sourceName: string;
    readonly device: string | null;
    readonly latestValue: string;
    readonly latestStartAt: string;
    readonly latestEndAt: string;
    readonly samplesInInput: number;
  }[];
  readonly healthHistory?: readonly HealthHistoryEntry[];
  readonly recentCheckins?: readonly {
    readonly id: string;
    readonly text: string;
    readonly at: Date;
    readonly receivedAt?: Date;
  }[];
  readonly mealsToday: readonly MealSummary[];
  readonly commitments: readonly Commitment[];
  readonly activeRoutines: readonly RoutineSummary[];
  readonly medications: readonly MedicationSummary[];
  readonly supplements: readonly string[];
  readonly interactionResults: readonly ExternalResultSummary[];
  readonly confoundDefinitions: readonly import("../gate").ConfoundDefinition[];
  readonly confoundEvaluations: readonly import("../gate").ConfoundEvaluation[];
}

/** Source assertions remain dated context, not newly verified clinical facts. */
export interface HealthHistoryEntry {
  readonly id: string;
  readonly category:
    | "condition"
    | "medication_history"
    | "supplement_history"
    | "goal"
    | "nutrition"
    | "training"
    | "sleep"
    | "preference"
    | "measurement"
    | "care_context";
  readonly statement: string;
  readonly sourceLabel: string;
  readonly sourceLocator: string;
  readonly sourceDate: string | null;
  readonly sourceDatePrecision?: "day" | "month" | "year" | "unknown";
  readonly temporalStatus: "historical" | "current" | "uncertain";
  readonly confirmationRequired: boolean;
}

export interface AdvisorInput {
  /** Injected, never read from the ambient clock. */
  readonly now: Date;
  /** When a delayed check-in was captured; received time is still `now`. */
  readonly capturedAt?: Date;
  readonly utterance: Utterance;
  readonly context: SubjectContext;
}

export interface SourceRef {
  readonly table: string;
  readonly id: string;
}

/** The PRD 9 decision object, in the shape the persistence layer writes. */
export interface DecisionDraft {
  readonly type: DecisionType;
  readonly domain: Domain;
  readonly evidenceStatus: EvidenceStatus;
  readonly ladderLevel: LadderLevel;
  readonly gateOutcome: GateOutcome;
  readonly gateReason: string;
  readonly confoundsChecked: readonly ConfoundCheck[];
  readonly confidenceNote: string;
  readonly target: string | null;
  readonly expectedLag: string | null;
  /** PRD 9 requires a "do nothing" option wherever one is meaningful. */
  readonly choices: readonly string[];
  /** What this output explicitly declines to claim. */
  readonly refused: string;
  readonly sources: readonly SourceRef[];
  readonly expiresAt: Date | null;
  readonly reviewAt: Date | null;
  readonly ruleId: string;
}

export type RecordDraft =
  | { readonly kind: "context_note"; readonly text: string }
  | { readonly kind: "symptom"; readonly text: string; readonly bodyRegion: string | null }
  | {
      readonly kind: "meal";
      readonly mealKind: MealSummary["kind"] | null;
      /** The user's own description, never a generated nutrition estimate. */
      readonly description: string | null;
    }
  | { readonly kind: "medication_event"; readonly text: string }
  | {
      readonly kind: "dermatology_handoff";
      /** The user's own wording, retained verbatim for the clinician. */
      readonly userWording: string;
    }
  | {
      readonly kind: "interaction_check_request";
      readonly items: readonly string[];
    }
  | {
      /** PRD 11.9: therapy content is inert. The fact is recorded; the text is not. */
      readonly kind: "therapy_mention";
    };

export interface AdvisorReply {
  readonly text: string;
  readonly kind: MessageKind;
  readonly receipt: string;
}

export interface AdvisorOutput {
  readonly reply: AdvisorReply;
  readonly decisions: readonly DecisionDraft[];
  readonly records: readonly RecordDraft[];
  /** PRD 4.3: ask only the highest-value follow-up, never a form. */
  readonly followUp: string | null;
  readonly route: RouteDestination | null;
  readonly trace: { readonly ruleId: string };
}

export interface Advisor {
  /** Stamped onto every decision so stored history knows what produced it. */
  readonly version: string;
  respond(input: AdvisorInput): Promise<AdvisorOutput>;
}

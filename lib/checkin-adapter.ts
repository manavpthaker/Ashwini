import { EVIDENCE_LABEL, type EvidenceStatus as DomainEvidenceStatus } from "@/domain/evidence";
import type { Domain } from "@/domain/domains";
import type {
  CheckinEffect,
  CheckinKind,
  CheckinResponse,
  EvidenceStatus,
  GateStatus,
  PerspectiveContribution,
} from "@/lib/product-model";

/**
 * The seam between the API and the redesigned interface.
 *
 * The interface was built against `lib/synthetic-scenario.ts`, which matches
 * declared demo phrases against an exact-string Set. That is fine for a mockup
 * and unusable as a safety layer: "crushing pressure in my chest" is not in the
 * fixture set, so it would fall through to the generic branch. The rule pipeline
 * in `domain/advisor` is the safety layer, and it runs on the server behind
 * `POST /api/conversation`.
 *
 * So the server decides, and this file translates its answer into the view model
 * the screens already render. Nothing here interprets the user's words — every
 * field below is read off the stored decision object (PRD 9). Where the server
 * says nothing, this returns nothing rather than inventing a default, because a
 * fabricated `Clear` gate is exactly the failure the gate exists to prevent.
 *
 * Pure and client-safe: no `server-only` import, no fetch, no clock.
 */

export type WireRouteDestination =
  "emergency" | "crisis_line" | "clinician" | "pharmacist" | "prescriber" | "dermatologist";

export type WireRecordKind =
  | "context_note"
  | "symptom"
  | "meal"
  | "medication_event"
  | "dermatology_handoff"
  | "interaction_check_request"
  | "therapy_mention";

/** The subset of the PRD 9 decision object the interface renders. */
export interface WireDecision {
  readonly type: "recommendation" | "data_quality_block" | "scheduled_review" | "route_out";
  readonly domain: Domain;
  readonly evidenceStatus: DomainEvidenceStatus;
  readonly gateOutcome: "clear" | "caveated" | "blocked";
  readonly gateReason: string;
  readonly confidenceNote: string;
  readonly target: string | null;
  readonly refused: string;
  readonly choices: readonly string[];
}

export interface WireReply {
  readonly text: string;
  readonly kind: "record" | "recommendation" | "question" | "route";
  readonly receipt: string;
}

export interface ConversationTurn {
  readonly reply: WireReply;
  readonly decisions: readonly WireDecision[];
  readonly records: readonly WireRecordKind[];
  readonly followUp: string | null;
  readonly route: WireRouteDestination | null;
}

const GATE_LABEL: Record<WireDecision["gateOutcome"], GateStatus> = {
  clear: "Clear",
  caveated: "Caveated",
  blocked: "Blocked",
};

const KIND_LABEL: Record<WireReply["kind"], CheckinKind> = {
  record: "record",
  recommendation: "recommendation",
  question: "follow-up",
  route: "route-out",
};

/**
 * A reasoning domain is not a person. PRD 4.3 allows the contributing
 * perspectives to be shown so the reasoning is inspectable, and forbids them
 * reading as separate agents or as proof a provider reviewed anything — which is
 * why every contribution below is stamped `ashwini_synthesis`.
 */
const PERSPECTIVE: Record<Domain, Pick<PerspectiveContribution, "role" | "tone">> = {
  training: { role: "Training", tone: "training" },
  nutrition: { role: "Nutrition", tone: "nutrition" },
  medication: { role: "Medication", tone: "medication" },
  body: { role: "Recovery", tone: "recovery" },
  focus: { role: "Recovery", tone: "recovery" },
  system: { role: "Care navigation", tone: "care" },
};

const ROUTE_HEADLINE: Record<WireRouteDestination, string> = {
  emergency: "This needs emergency care now",
  crisis_line: "Please talk to someone now",
  clinician: "A clinician needs to look at this",
  pharmacist: "Your pharmacist should answer this",
  prescriber: "Your prescriber should answer this",
  dermatologist: "Documented for a dermatologist, not assessed here",
};

const RECORD_LABEL: Record<WireRecordKind, string> = {
  context_note: "Context note kept with this check-in",
  symptom: "Symptom report recorded",
  meal: "Meal recorded — held as a range, not a number",
  medication_event: "Medication event recorded in the protected lane",
  dermatology_handoff: "Skin observation documented for a dermatologist, not analysed",
  interaction_check_request: "Interaction check requested",
  therapy_mention: "Therapy mention recorded as a fact — its content was not stored",
};

/**
 * Route destinations split into the two handoffs the interface already
 * distinguishes: one is "stop and get seen", the other is "a medicines question
 * only a professional should answer". Both withhold the training plan; they read
 * differently to the user and PRD 4.4 wants a route-out to be a concise handoff
 * rather than one undifferentiated alarm.
 */
function attentionFor(route: WireRouteDestination): NonNullable<CheckinEffect["attention"]> {
  return route === "pharmacist" || route === "prescriber" ? "medication-event" : "urgent-care";
}

/**
 * The day state the Today and Plan screens reduce over. Only what the server
 * actually established is set; everything else is left undefined so
 * `deriveDayState` carries the previous value forward instead of a guess.
 */
function effectsFor(turn: ConversationTurn, decision: WireDecision | undefined): CheckinEffect {
  const effects: {
    -readonly [K in keyof CheckinEffect]: CheckinEffect[K];
  } = {};

  if (turn.records.includes("meal")) {
    effects.mealStatus = turn.followUp ? "needs-detail" : "recorded";
  }

  if (turn.route) {
    // A route-out withholds the training verdict whatever the domain: PRD 11.5.
    effects.trainingGate = "blocked";
    effects.recommendedTrainingChoice = "pause";
    effects.attention = attentionFor(turn.route);
  } else if (decision && decision.domain === "training") {
    if (decision.gateOutcome === "blocked") {
      effects.trainingGate = "blocked";
      effects.recommendedTrainingChoice = "pause";
    } else if (decision.gateOutcome === "caveated") {
      effects.trainingGate = "caution";
      effects.recommendedTrainingChoice = "reduced";
    } else {
      effects.trainingGate = "clear";
    }
  } else if (decision && decision.type === "data_quality_block") {
    effects.trainingGate = "blocked";
    effects.recommendedTrainingChoice = "pause";
  }

  return effects;
}

function headlineFor(turn: ConversationTurn, decision: WireDecision | undefined): string {
  if (turn.route) return ROUTE_HEADLINE[turn.route];
  if (decision?.target) return decision.target;
  return turn.reply.receipt;
}

/**
 * Translate one server turn into the response shape the screens render.
 *
 * `interpretation` is the decision's confidence note and `recommendation` is the
 * advisor's own reply, both verbatim. There is deliberately no `acknowledgement`:
 * the synthetic engine wrote one, the advisor does not, and composing a warm
 * opening line here would be this file inventing product voice on top of a
 * safety decision.
 */
export function toCheckinResponse(turn: ConversationTurn): CheckinResponse {
  const decision = turn.decisions[0];
  const status: EvidenceStatus = decision
    ? (EVIDENCE_LABEL[decision.evidenceStatus] as EvidenceStatus)
    : "Recorded";

  return {
    kind: KIND_LABEL[turn.reply.kind],
    status,
    gate: decision ? GATE_LABEL[decision.gateOutcome] : "Blocked",
    headline: headlineFor(turn, decision),
    acknowledgement: "",
    interpretation: decision?.confidenceNote ?? "",
    recommendation: turn.reply.text,
    ...(turn.followUp ? { followUp: turn.followUp } : {}),
    receipt: turn.reply.receipt,
    recorded: [
      "Your wording, retained verbatim",
      ...turn.records.map((kind) => RECORD_LABEL[kind]),
    ],
    perspectives: decision ? [perspectiveFor(decision)] : [],
    effects: effectsFor(turn, decision),
    ...(decision ? { refused: decision.refused, gateReason: decision.gateReason } : {}),
  };
}

function perspectiveFor(decision: WireDecision): PerspectiveContribution {
  const { role, tone } = PERSPECTIVE[decision.domain];
  return {
    role,
    tone,
    state: GATE_LABEL[decision.gateOutcome],
    summary: decision.confidenceNote,
    basis: decision.gateReason,
    origin: "ashwini_synthesis",
  };
}

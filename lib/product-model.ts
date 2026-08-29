export type EvidenceStatus =
  | "Recorded"
  | "Unusable"
  | "Rule-based"
  | "Noticed"
  | "Tracking"
  | "Early signal"
  | "Consistent pattern"
  | "Personally useful"
  | "Route out";

export type GateStatus = "Clear" | "Caveated" | "Blocked";
export type PerspectiveRole = "Nutrition" | "Recovery" | "Training" | "Medication" | "Care navigation";
export type PerspectiveTone = "nutrition" | "recovery" | "training" | "medication" | "care";
export type CheckinKind = "record" | "follow-up" | "recommendation" | "route-out";
export type MealStatus = "missing" | "needs-detail" | "recorded" | "skipped";
export type TrainingChoice = "hold" | "full" | "reduced" | "pause";
export type TrainingGate = "pending" | "clear" | "caution" | "blocked";
export type AttentionState = "none" | "urgent-care" | "medication-event";
export type ScenarioPhase = "midday" | "pre-session";

export interface PerspectiveContribution {
  role: PerspectiveRole;
  tone: PerspectiveTone;
  state: string;
  summary: string;
  basis: string;
  origin: "ashwini_synthesis";
}

export interface CheckinEffect {
  mealStatus?: MealStatus;
  trainingGate?: TrainingGate;
  recommendedTrainingChoice?: TrainingChoice;
  attention?: Exclude<AttentionState, "none">;
  scenarioPhase?: ScenarioPhase;
}

export interface CheckinResponse {
  kind: CheckinKind;
  status: EvidenceStatus;
  gate: GateStatus;
  headline: string;
  acknowledgement: string;
  interpretation: string;
  recommendation: string;
  followUp?: string;
  receipt: string;
  recorded: readonly string[];
  perspectives: readonly PerspectiveContribution[];
  effects: CheckinEffect;
  deferredPlanResponse?: CheckinResponse;
}

export interface CheckinRecord {
  id: string;
  time: string;
  originalInput: string;
  modality: "text";
  correctionOf?: string;
  response: CheckinResponse;
}

export interface DerivedDayState {
  mealStatus: MealStatus;
  trainingGate: TrainingGate;
  recommendedTrainingChoice: TrainingChoice;
  attention: AttentionState;
  scenarioPhase: ScenarioPhase;
}

export interface RoutineSummary {
  id: string;
  domain: string;
  title: string;
  status: EvidenceStatus;
  progress: string;
  behavior: string;
  target: string;
  nextReview: string;
  evidence: string;
  confounds: string;
}

export interface DayEvent {
  time: string;
  domain: string;
  title: string;
  detail: string;
  state: "complete" | "current" | "upcoming" | "withheld" | "paused";
}

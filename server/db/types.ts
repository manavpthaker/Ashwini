import "server-only";
import type { ColumnType, Generated } from "kysely";
import type { Domain } from "@/domain/domains";
import type { EvidenceStatus, GateOutcome } from "@/domain/evidence";
import type { DecisionType, MessageKind, RecordDraft, RouteDestination } from "@/domain/advisor";

/**
 * The Kysely view of the tables the application currently reads and writes.
 *
 * Hand-written rather than generated, deliberately: it covers the subset in use
 * and reuses the domain unions, so a status the domain layer cannot produce is
 * also one the query builder will not compile. `pnpm db:types` regenerates the
 * full schema from a live database when the surface grows past this.
 *
 * Timestamps are ColumnType<Date, Date | string, never> — never on update,
 * because these tables are append-only (20260829000900_security.sql).
 */

type Timestamp = ColumnType<Date, Date | string | undefined, never>;
/** Write-once and never updated. */
type Immutable<T> = ColumnType<T, T, never>;
/** Write-once, never updated, and optional on insert because the column has a default. */
type ImmutableDefault<T> = ColumnType<T, T | undefined, never>;

export interface MessagesTable {
  message_id: Generated<string>;
  ts: Timestamp;
  role: Immutable<"user" | "ashwini">;
  text: Immutable<string>;
  kind: Immutable<MessageKind | null>;
  receipt: Immutable<string | null>;
  in_reply_to: Immutable<string | null>;
  /** The one mutable column: a correction points forward, it does not overwrite. */
  corrected_by: ColumnType<string | null, string | null, string | null>;
  advisor_version: Immutable<string | null>;
  rule_id: Immutable<string | null>;
  idempotency_key: Immutable<string | null>;
  captured_at: Immutable<Date | null>;
}

export interface DecisionsTable {
  decision_id: Generated<string>;
  created_ts: Timestamp;
  type: Immutable<DecisionType>;
  domain: Immutable<Domain>;
  evidence_status: Immutable<EvidenceStatus>;
  ladder_level: Immutable<number>;
  confidence_note: Immutable<string>;
  gate_outcome: Immutable<GateOutcome>;
  gate_reason: Immutable<string>;
  confounds_checked: ImmutableDefault<unknown>;
  window_start: Immutable<Date | null>;
  window_end: Immutable<Date | null>;
  source_refs: ImmutableDefault<unknown>;
  target: Immutable<string | null>;
  expected_lag: Immutable<string | null>;
  choices: ImmutableDefault<unknown>;
  refused: Immutable<string>;
  expires_at: Immutable<Date | null>;
  review_at: Immutable<Date | null>;
  supersedes: Immutable<string | null>;
  advisor_version: Immutable<string>;
  rule_id: Immutable<string>;
  message_id: Immutable<string | null>;
  route_destination: Immutable<RouteDestination | null>;
}

export interface DecisionResponsesTable {
  response_id: Generated<string>;
  decision_id: Immutable<string>;
  responded_ts: Timestamp;
  choice: Immutable<string>;
  note: Immutable<string | null>;
  was_override: ImmutableDefault<boolean>;
  override_reason: Immutable<string | null>;
}

export interface DecisionOutcomesTable {
  outcome_id: Generated<string>;
  decision_id: Immutable<string>;
  resolved_ts: Immutable<Date | null>;
  outcome: Immutable<string | null>;
  unresolved_reason: Immutable<string | null>;
}

export interface RoutedRecordsTable {
  message_id: Immutable<string>;
  record_table: Immutable<string>;
  record_id: Immutable<string>;
  /** The advisor's own RecordDraft kind, so the read path need not infer it. */
  record_kind: Immutable<RecordDraft["kind"]>;
}

export interface MealsTable {
  meal_id: Generated<string>;
  ts: ColumnType<Date, Date | string, Date | string>;
  kind: "breakfast" | "lunch" | "dinner" | "snack" | null;
  description: string | null;
  source: "text" | "photo" | "reference" | "recipe";
  reference_id: string | null;
  confidence: "low" | "medium" | "high";
  /** Ranges only. PRD 7.2 — there is no scalar column to write to. */
  kcal_low: number | null;
  kcal_high: number | null;
  protein_low_g: number | null;
  protein_high_g: number | null;
  message_id: string | null;
}

export interface SymptomsTable {
  symptom_id: Generated<string>;
  ts: ColumnType<Date, Date | string | undefined, Date | string>;
  text: string;
  body_region: string | null;
  message_id: string | null;
  routed_to: RouteDestination | null;
}

export interface TherapyMentionsTable {
  mention_id: Generated<string>;
  ts: Timestamp;
  message_id: Immutable<string | null>;
}

export interface DermatologyHandoffsTable {
  handoff_id: Generated<string>;
  reported_ts: Timestamp;
  user_wording: Immutable<string>;
  routed_to: ImmutableDefault<RouteDestination>;
  message_id: Immutable<string | null>;
  capture_series_started: ImmutableDefault<boolean>;
}

export interface ConfoundDefinitionsTable {
  confound_id: string;
  label: string;
  domains: Domain[];
  blocking: boolean;
  required_for_verdict: boolean;
  threshold: unknown;
  version: string;
  active: boolean;
}

export interface ConfoundEvaluationsTable {
  eval_id: Generated<string>;
  confound_id: Immutable<string>;
  subject_kind: Immutable<"decision" | "routine_review" | "window">;
  subject_id: Immutable<string | null>;
  evaluated_ts: Timestamp;
  state: Immutable<"absent" | "present" | "unknown">;
  detail: Immutable<string | null>;
  window_start: Immutable<Date | null>;
  window_end: Immutable<Date | null>;
}

export interface ExternalResultsTable {
  result_id: Generated<string>;
  provider: Immutable<string>;
  items: Immutable<string[]>;
  query: ImmutableDefault<unknown>;
  requested_ts: Timestamp;
  response: Immutable<unknown>;
  evidence_grade: Immutable<string | null>;
  references: ImmutableDefault<unknown>;
  license_note: Immutable<string | null>;
  cache_expires_at: Immutable<Date | null>;
  http_status: Immutable<number | null>;
  error: Immutable<string | null>;
}

export interface CommitmentsTable {
  commitment_id: Generated<string>;
  starts_at: ColumnType<Date, Date | string, Date | string>;
  ends_at: Date | null;
  domain: Domain;
  title: string;
  detail: string | null;
  kind: "training" | "meal" | "dose" | "review" | "capture" | "other";
  decision_id: string | null;
}

export interface DosesTable {
  dose_id: Generated<string>;
  med_id: string;
  scheduled_ts: Date | null;
  taken_ts: Date | null;
  skipped: boolean;
  skip_reason: string | null;
  note: string | null;
}

export interface ReminderDispatchesTable {
  dispatch_id: Generated<string>;
  dose_id: Immutable<string>;
  scheduled_for: Immutable<Date>;
  dispatched_at: Timestamp;
  channel: Immutable<"brownbot" | "log">;
  status: Immutable<"sent" | "failed" | "skipped">;
  detail: Immutable<string | null>;
}

export interface InterventionsTable {
  intervention_id: Generated<string>;
  name: string;
  category:
    "supplement" | "topical" | "training_block" | "diet_protocol" | "behavior" | "environmental";
  dose: number | null;
  unit: string | null;
  started_at: Date;
  stopped_at: Date | null;
  notes: string | null;
}

export interface MedicationsTable {
  med_id: Generated<string>;
  name: string;
  dose: number;
  unit: string;
  schedule_rrule: string | null;
  prn: boolean;
  purpose: string | null;
  prescriber: string | null;
  class: string | null;
  started_at: Date;
  stopped_at: Date | null;
  days_supply: number | null;
  last_fill_date: Date | null;
  /** Always false; the database refuses anything else (PRD 11.6). */
  manipulable: boolean;
}

export interface Database {
  "ashwini.messages": MessagesTable;
  "ashwini.decisions": DecisionsTable;
  "ashwini.decision_responses": DecisionResponsesTable;
  "ashwini.decision_outcomes": DecisionOutcomesTable;
  "ashwini.routed_records": RoutedRecordsTable;
  "ashwini.meals": MealsTable;
  "ashwini.symptoms": SymptomsTable;
  "ashwini.therapy_mentions": TherapyMentionsTable;
  "ashwini.dermatology_handoffs": DermatologyHandoffsTable;
  "ashwini.confound_definitions": ConfoundDefinitionsTable;
  "ashwini.confound_evaluations": ConfoundEvaluationsTable;
  "ashwini.external_results": ExternalResultsTable;
  "ashwini.commitments": CommitmentsTable;
  "ashwini.medications": MedicationsTable;
  "ashwini.interventions": InterventionsTable;
  "ashwini.doses": DosesTable;
  "ashwini.reminder_dispatches": ReminderDispatchesTable;
}

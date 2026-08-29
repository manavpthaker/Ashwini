-- PRD 9: the decision object.
--
-- The most important table here and the one the original schema had no
-- equivalent for. PRD 9 exists so Ashwini "can later answer whether its
-- suggestion was useful, ignored, impossible, or wrong" — which requires the
-- decision, the response, and the outcome to be three separate, durable facts
-- recorded at three different times.
--
-- These tables are append-only. 20260829000900_security.sql revokes UPDATE and
-- DELETE from the application role rather than relying on discipline.

create table ashwini.decisions (
  decision_id uuid primary key default gen_random_uuid(),
  created_ts timestamptz not null default now(),

  type ashwini.decision_type not null,
  domain ashwini.domain not null,

  evidence_status ashwini.evidence_status not null,   -- PRD 4.5
  ladder_level smallint not null check (ladder_level between 0 and 5), -- PRD 5
  -- Prose, never a bare number. PRD 4.5: a guess cannot become a fact by
  -- repeated display, and "0.73" displays as a fact.
  confidence_note text not null,

  -- PRD 8. The outcome, why, and every confound consulted with its threshold
  -- version, so the decision can be re-read against the rules that produced it.
  gate_outcome ashwini.gate_outcome not null,
  gate_reason text not null,
  confounds_checked jsonb not null default '[]',

  window_start timestamptz,
  window_end timestamptz,
  source_refs jsonb not null default '[]',

  target text,
  expected_lag text,

  -- PRD 9 requires "do nothing" to be available wherever it is meaningful.
  choices jsonb not null default '[]',
  -- What this output explicitly declines to claim. PRD 4.5, 11.10.
  refused text not null,

  expires_at timestamptz,
  review_at timestamptz,
  supersedes uuid references ashwini.decisions,

  -- What produced this. Essential before any model-backed advisor exists: it
  -- keeps rule-era history from being silently reinterpreted later.
  advisor_version text not null,
  rule_id text not null,

  message_id uuid references ashwini.messages on delete set null,
  route_destination ashwini.route_destination,

  -- PRD 11.5, in the database as well as in domain/evidence.ts: a blocked
  -- window may only carry an unusable or route_out label.
  constraint blocked_windows_issue_no_verdict check (
    gate_outcome <> 'blocked'
    or evidence_status in ('unusable', 'route_out')
  ),
  -- PRD 5: a level 4 personal comparison result needs an uncontaminated window.
  constraint level_four_requires_clear_gate check (
    ladder_level <> 4 or gate_outcome = 'clear'
  )
);
create index decisions_created_idx on ashwini.decisions (created_ts desc);
create index decisions_open_idx on ashwini.decisions (expires_at)
  where expires_at is not null;

create table ashwini.decision_responses (
  response_id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references ashwini.decisions,
  responded_ts timestamptz not null default now(),
  choice text not null,
  note text,
  -- PRD 8: "A user override, if ever allowed, must be explicit and permanently
  -- retained with the output it affected."
  was_override boolean not null default false,
  override_reason text,
  constraint override_states_its_reason check (
    not was_override or override_reason is not null
  )
);
create index decision_responses_decision_idx on ashwini.decision_responses (decision_id);

create table ashwini.decision_outcomes (
  outcome_id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references ashwini.decisions,
  resolved_ts timestamptz,
  outcome text,
  -- PRD 9 asks the record to distinguish "wrong" from "never got answered".
  unresolved_reason text,
  constraint outcome_or_reason check (
    outcome is not null or unresolved_reason is not null
  )
);
create index decision_outcomes_decision_idx on ashwini.decision_outcomes (decision_id);

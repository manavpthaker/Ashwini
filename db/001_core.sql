-- ashwini is a private, single-subject health system.
-- This migration establishes Phase 0/0.5 storage only; it makes no clinical inferences.

create extension if not exists pgcrypto;

create type intervention_category as enum ('supplement', 'topical', 'training_block', 'diet_protocol', 'behavior', 'environmental');
create type capture_protocol as enum ('face_grid', 'hairline', 'part_line', 'body_front', 'body_side', 'posture_front', 'posture_side');
create type edge_status as enum ('hypothesized', 'literature_supported', 'correlation_observed', 'experiment_confirmed', 'ruled_out');

create table metrics (
  metric_id uuid primary key default gen_random_uuid(), ts timestamptz not null,
  name text not null, value numeric not null, unit text not null, source text not null,
  confidence numeric check (confidence between 0 and 1), derived_from uuid[] default '{}'
);
create index metrics_name_ts_idx on metrics (name, ts desc);

create table interventions (
  intervention_id uuid primary key default gen_random_uuid(), name text not null,
  category intervention_category not null, dose numeric, unit text, started_at date not null,
  stopped_at date, notes text
);
create table medications (
  med_id uuid primary key default gen_random_uuid(), name text not null, dose numeric not null,
  unit text not null, schedule_rrule text, prn boolean not null default false, purpose text,
  prescriber text, class text, started_at date not null, stopped_at date, days_supply integer,
  last_fill_date date, manipulable boolean not null default false,
  constraint prescribed_meds_are_not_experiments check (manipulable = false)
);
create table doses (
  dose_id uuid primary key default gen_random_uuid(), med_id uuid not null references medications on delete cascade,
  scheduled_ts timestamptz, taken_ts timestamptz, skipped boolean not null default false,
  skip_reason text, note text, check (not skipped or taken_ts is null)
);
create index doses_med_scheduled_idx on doses (med_id, scheduled_ts desc);
create table captures (
  capture_id uuid primary key default gen_random_uuid(), protocol capture_protocol not null,
  ts timestamptz not null, path text not null, lamp_state text, color_card_present boolean not null default false,
  alignment_score numeric, normalized_path text
);
create table observations (
  obs_id uuid primary key default gen_random_uuid(), question_id text not null, ts timestamptz not null,
  response boolean, axis text, weight numeric, latency_ms integer, responded boolean not null default false
);
create table experiments (
  exp_id uuid primary key default gen_random_uuid(), intervention_id uuid not null references interventions,
  target_metric text not null, baseline_start date not null, baseline_end date not null,
  active_start date, active_end date, washout_days integer not null default 0,
  confounds_checked jsonb not null default '[]', verdict text, effect_size numeric, notes text
);
create table documents (
  doc_id uuid primary key default gen_random_uuid(), type text not null, ts timestamptz not null,
  path text not null, parsed_metrics uuid[] default '{}', traversable boolean not null default true
);
create table edges (
  edge_id uuid primary key default gen_random_uuid(), from_node text not null, to_node text not null,
  status edge_status not null default 'hypothesized', effect_size numeric, lag_days integer,
  n integer, confidence numeric check (confidence between 0 and 1), controlled_for text[] default '{}',
  first_seen timestamptz not null default now(), last_evaluated timestamptz
);

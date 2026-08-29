-- ashwini is a private, single-subject health system.
-- Phase 0/0.5 storage. It makes no clinical inferences.
--
-- Everything lives in the `ashwini` schema, not `public`, and this is a security
-- control rather than tidiness: Supabase exposes PostgREST publicly at
-- https://<ref>.supabase.co/rest/v1/ and serves the `public` schema by default.
-- Keeping health tables out of `public` — and out of the project's Exposed
-- Schemas — means the anon key has nothing to read even before RLS is consulted.
-- 20260829000900_security.sql adds RLS as the second layer.
--
-- This file is the former db/001_core.sql, retargeted. It had never been applied
-- to any database, so moving it was free.

create schema if not exists ashwini;

create extension if not exists pgcrypto;

create type ashwini.intervention_category as enum (
  'supplement', 'topical', 'training_block', 'diet_protocol', 'behavior', 'environmental'
);
create type ashwini.capture_protocol as enum (
  'face_grid', 'hairline', 'part_line', 'body_front', 'body_side', 'posture_front', 'posture_side'
);

-- NOTE: this describes edges in a knowledge graph — "does creatine relate to X" —
-- and is NOT the PRD 4.5 evidence vocabulary. See 20260829000200_vocabulary.sql.
create type ashwini.edge_status as enum (
  'hypothesized', 'literature_supported', 'correlation_observed', 'experiment_confirmed', 'ruled_out'
);

create table ashwini.metrics (
  metric_id uuid primary key default gen_random_uuid(),
  ts timestamptz not null,
  name text not null,
  value numeric not null,
  unit text not null,
  source text not null,
  confidence numeric check (confidence between 0 and 1),
  derived_from uuid[] default '{}'
);
create index metrics_name_ts_idx on ashwini.metrics (name, ts desc);

create table ashwini.interventions (
  intervention_id uuid primary key default gen_random_uuid(),
  name text not null,
  category ashwini.intervention_category not null,
  dose numeric,
  unit text,
  started_at date not null,
  stopped_at date,
  notes text
);

create table ashwini.medications (
  med_id uuid primary key default gen_random_uuid(),
  name text not null,
  dose numeric not null,
  unit text not null,
  schedule_rrule text,
  prn boolean not null default false,
  purpose text,
  prescriber text,
  class text,
  started_at date not null,
  stopped_at date,
  days_supply integer,
  last_fill_date date,
  manipulable boolean not null default false,
  -- PRD 11.6, enforced by the database rather than by convention.
  constraint prescribed_meds_are_not_experiments check (manipulable = false)
);

create table ashwini.doses (
  dose_id uuid primary key default gen_random_uuid(),
  med_id uuid not null references ashwini.medications on delete cascade,
  scheduled_ts timestamptz,
  taken_ts timestamptz,
  skipped boolean not null default false,
  skip_reason text,
  note text,
  check (not skipped or taken_ts is null)
);
create index doses_med_scheduled_idx on ashwini.doses (med_id, scheduled_ts desc);

create table ashwini.captures (
  capture_id uuid primary key default gen_random_uuid(),
  protocol ashwini.capture_protocol not null,
  ts timestamptz not null,
  path text not null,
  lamp_state text,
  color_card_present boolean not null default false,
  alignment_score numeric,
  normalized_path text
);

create table ashwini.observations (
  obs_id uuid primary key default gen_random_uuid(),
  question_id text not null,
  ts timestamptz not null,
  response boolean,
  axis text,
  weight numeric,
  latency_ms integer,
  responded boolean not null default false
);

create table ashwini.experiments (
  exp_id uuid primary key default gen_random_uuid(),
  intervention_id uuid not null references ashwini.interventions,
  target_metric text not null,
  baseline_start date not null,
  baseline_end date not null,
  active_start date,
  active_end date,
  washout_days integer not null default 0,
  confounds_checked jsonb not null default '[]',
  verdict text,
  effect_size numeric,
  notes text
);

create table ashwini.documents (
  doc_id uuid primary key default gen_random_uuid(),
  type text not null,
  ts timestamptz not null,
  path text not null,
  parsed_metrics uuid[] default '{}',
  traversable boolean not null default true
);

create table ashwini.edges (
  edge_id uuid primary key default gen_random_uuid(),
  from_node text not null,
  to_node text not null,
  status ashwini.edge_status not null default 'hypothesized',
  effect_size numeric,
  lag_days integer,
  n integer,
  confidence numeric check (confidence between 0 and 1),
  controlled_for text[] default '{}',
  first_seen timestamptz not null default now(),
  last_evaluated timestamptz
);

comment on table ashwini.edges is
  'Deferred PRD 13.7 knowledge-graph layer. Unused today. edge_status is NOT the PRD 4.5 evidence vocabulary — that is ashwini.evidence_status. Do not conflate them.';

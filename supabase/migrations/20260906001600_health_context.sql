-- Curated, source-backed assertions. Historical statements are not silently
-- promoted to current diagnoses, prescription schedules, or adherence events.
create table ashwini.health_context_sources (
  source_id uuid primary key default gen_random_uuid(),
  source_key text not null,
  source_label text not null,
  source_locator text not null,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  curation_revision integer not null default 1 check (curation_revision > 0),
  source_date date,
  date_precision text not null check (date_precision in ('day', 'month', 'year', 'unknown')),
  imported_ts timestamptz not null default now(),
  version_seq bigint generated always as identity,
  unique (source_key, content_hash, curation_revision),
  check ((source_date is null) = (date_precision = 'unknown')),
  check (date_precision <> 'year' or to_char(source_date, 'MM-DD') = '01-01'),
  check (date_precision <> 'month' or extract(day from source_date) = 1)
);
create index health_context_sources_latest_idx
  on ashwini.health_context_sources (source_key, version_seq desc);

create table ashwini.health_context_entries (
  context_id uuid primary key default gen_random_uuid(),
  source_id uuid not null references ashwini.health_context_sources(source_id),
  entry_key text not null,
  category text not null check (category in (
    'condition', 'medication_history', 'supplement_history', 'goal', 'nutrition',
    'training', 'sleep', 'preference', 'measurement', 'care_context'
  )),
  statement text not null check (length(statement) between 1 and 1200),
  source_locator text not null,
  source_date date,
  date_precision text not null check (date_precision in ('day', 'month', 'year', 'unknown')),
  temporal_status text not null check (temporal_status in ('historical', 'current', 'uncertain')),
  confirmation_required boolean not null,
  unique (source_id, entry_key),
  check ((source_date is null) = (date_precision = 'unknown')),
  check (date_precision <> 'year' or to_char(source_date, 'MM-DD') = '01-01'),
  check (date_precision <> 'month' or extract(day from source_date) = 1),
  check (category not in ('medication_history', 'supplement_history') or confirmation_required)
);

create trigger health_context_sources_append_only
  before update or delete on ashwini.health_context_sources
  for each row execute function ashwini.refuse_mutation();
create trigger health_context_entries_append_only
  before update or delete on ashwini.health_context_entries
  for each row execute function ashwini.refuse_mutation();

alter table ashwini.health_context_sources enable row level security;
alter table ashwini.health_context_entries enable row level security;
revoke all on ashwini.health_context_sources, ashwini.health_context_entries from public;
revoke all on sequence ashwini.health_context_sources_version_seq_seq from public;

comment on table ashwini.health_context_sources is
  'Private source versions. Raw documents and therapy narratives are not stored. The latest imported version per source_key supplies current context; older versions remain auditable.';
comment on table ashwini.health_context_entries is
  'Curated source assertions with temporal uncertainty. Not diagnoses, active prescriptions, adherence, or evidence of personal effectiveness.';

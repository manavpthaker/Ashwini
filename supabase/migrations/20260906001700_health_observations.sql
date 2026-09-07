-- Owner-private imported observations, separate from research evidence and
-- current medication/adherence records. Export fingerprints identify batches;
-- observation identity intentionally survives repeated/overlapping exports.
create table ashwini.health_import_batches (
  import_id uuid primary key default gen_random_uuid(),
  format text not null check (format = 'apple-health-xml-v1'),
  fingerprint text not null unique check (fingerprint ~ '^[a-f0-9]{64}$'),
  imported_at timestamptz not null default now(),
  report jsonb not null
);

create table ashwini.health_observations (
  identity text primary key check (identity ~ '^[a-f0-9]{64}$'),
  first_import_id uuid not null references ashwini.health_import_batches(import_id),
  kind text not null check (kind in ('record', 'workout')),
  type text not null,
  value text not null,
  unit text,
  source_name text not null,
  source_version text,
  device text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  original_start_at text not null,
  original_end_at text not null,
  source_created_at timestamptz,
  check (end_at >= start_at)
);
create index health_observations_type_time_idx
  on ashwini.health_observations(type, end_at desc);
create index health_observations_time_idx
  on ashwini.health_observations(end_at desc);

create table ashwini.health_observation_imports (
  import_id uuid not null references ashwini.health_import_batches(import_id),
  observation_identity text not null references ashwini.health_observations(identity),
  primary key (import_id, observation_identity)
);

alter table ashwini.health_import_batches enable row level security;
alter table ashwini.health_observations enable row level security;
alter table ashwini.health_observation_imports enable row level security;
revoke all on ashwini.health_import_batches, ashwini.health_observations,
  ashwini.health_observation_imports from public;

create trigger health_import_batches_append_only
  before update or delete on ashwini.health_import_batches
  for each row execute function ashwini.refuse_mutation();
create trigger health_observations_append_only
  before update or delete on ashwini.health_observations
  for each row execute function ashwini.refuse_mutation();
create trigger health_observation_imports_append_only
  before update or delete on ashwini.health_observation_imports
  for each row execute function ashwini.refuse_mutation();

comment on table ashwini.health_observations is
  'Dated imported measurements, not clinical conclusions. Never sum overlapping sources blindly. No route coordinates or third-party metadata.';

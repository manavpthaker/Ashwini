-- PRD 4.9, 7.7, 11.10, 11.11: provenance, external evidence, reference assets.

create table ashwini.sources (
  source_id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null,
  owner text not null,
  state ashwini.source_state not null,
  note text,
  last_seen_ts timestamptz
);

-- PRD 11.9: therapy material is excluded from inference. Seeded as a row so the
-- exclusion is a database fact with a visible owner, not a comment in code.
insert into ashwini.sources (name, kind, owner, state, note) values
  ('Therapy notes', 'document', 'user', 'excluded',
   'PRD 11.9: inert. Never an inference source; transcripts are out of initial scope.'),
  ('Examine Connect', 'api', 'third_party', 'needs_review',
   'PRD 7.7: supplement-drug and supplement-supplement safety only. No drug-drug, efficacy or dosing.');

-- PRD 7.7: "Every external result retains the provider, query time, evidence
-- grade, references, and license/cache constraints."
--
-- Doubles as the Examine cache, with the TTL stored as data so the licence
-- constraint governs expiry rather than a hardcoded number.
create table ashwini.external_results (
  result_id uuid primary key default gen_random_uuid(),
  provider text not null,
  -- The normalised item set that was checked, sorted, so a lookup can match it.
  items text[] not null,
  query jsonb not null default '{}',
  requested_ts timestamptz not null default now(),
  response jsonb,
  evidence_grade text,
  "references" jsonb not null default '[]',
  license_note text,
  cache_expires_at timestamptz,
  http_status integer,
  -- A failed check is recorded too. PRD 7.3: a missing result is never evidence
  -- that an interaction does not exist, so the absence has to be visible.
  error text
);
create index external_results_lookup_idx
  on ashwini.external_results (provider, items, requested_ts desc);

comment on table ashwini.external_results is
  'PRD 7.7. Failed and empty checks are stored as rows: a missing result must be legible as "not checked", never as "nothing found".';

-- PRD 4.9 / 11.11: every reference asset carries its own provenance. The
-- prototype had one global constant for the whole library, which cannot say
-- that one card is reviewed and another is a scaffold.
create table ashwini.reference_assets (
  asset_id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  asset_type text not null,
  title text not null,
  body jsonb not null default '{}',
  source text not null,
  provenance text not null,
  version text not null,
  review_status text not null,
  safety_boundary text not null,
  updated_ts timestamptz not null default now()
);

-- Personal notes attach to an asset but stay user context. PRD 4.9: they are
-- never evidence that the asset is personally effective or appropriate.
create table ashwini.reference_notes (
  note_id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references ashwini.reference_assets on delete cascade,
  ts timestamptz not null default now(),
  text text not null
);

-- PRD 11.4: documented, never analysed.
create table ashwini.dermatology_handoffs (
  handoff_id uuid primary key default gen_random_uuid(),
  reported_ts timestamptz not null default now(),
  -- Verbatim. Ashwini adds no description of its own, by design.
  user_wording text not null,
  routed_to ashwini.route_destination not null default 'dermatologist',
  message_id uuid references ashwini.messages on delete set null,
  capture_series_started boolean not null default false
);

comment on table ashwini.dermatology_handoffs is
  'PRD 11.4. Records that a skin mark was reported and routed. It deliberately holds no assessment, description, or likelihood field.';

-- PRD 7.4: low-standardisation captures are marked and excluded from review.
alter table ashwini.captures
  add column excluded boolean not null default false,
  add column exclusion_reason text,
  add column pair_id uuid,
  add column standardization jsonb not null default '{}';

create index captures_pair_idx on ashwini.captures (pair_id) where pair_id is not null;

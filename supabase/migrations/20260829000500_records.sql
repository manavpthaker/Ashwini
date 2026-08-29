-- Day-to-day records: meals, symptoms, commitments, training.

-- PRD 7.2. The structural rule this table exists to enforce:
--
--   "The output must show uncertainty — range or confidence, not fabricated
--    exactness — and be used for trends, weekly averages, and pattern learning
--    rather than a claim of nutritional ground truth."
--
-- There is no `kcal` column and there must never be one. A scalar is how a
-- photo estimate quietly becomes a fact, so the schema makes it impossible
-- rather than asking the UI to remember.
create table ashwini.meal_references (
  reference_id uuid primary key default gen_random_uuid(),
  -- The user's own name for a recurring meal, e.g. "House Dal v1" (PRD 7.2).
  name text not null,
  version integer not null default 1,
  created_ts timestamptz not null default now(),
  notes text,
  kcal_low numeric,
  kcal_high numeric,
  protein_low_g numeric,
  protein_high_g numeric,
  unique (name, version),
  check (kcal_low is null or kcal_high is null or kcal_low <= kcal_high),
  check (protein_low_g is null or protein_high_g is null or protein_low_g <= protein_high_g)
);

create table ashwini.meals (
  meal_id uuid primary key default gen_random_uuid(),
  ts timestamptz not null,
  kind ashwini.meal_kind,
  description text,
  source text not null check (source in ('text', 'photo', 'reference', 'recipe')),
  reference_id uuid references ashwini.meal_references,
  confidence ashwini.estimate_confidence not null,
  kcal_low numeric,
  kcal_high numeric,
  protein_low_g numeric,
  protein_high_g numeric,
  message_id uuid references ashwini.messages on delete set null,
  check (kcal_low is null or kcal_high is null or kcal_low <= kcal_high),
  check (protein_low_g is null or protein_high_g is null or protein_low_g <= protein_high_g)
);
create index meals_ts_idx on ashwini.meals (ts desc);

comment on table ashwini.meals is
  'PRD 7.2. Estimates are stored as ranges only. Adding a scalar kcal or protein column would let a photo estimate present as ground truth.';

-- PRD 7.2 step 2: ask for only the highest-value correction, and keep it.
create table ashwini.meal_corrections (
  correction_id uuid primary key default gen_random_uuid(),
  meal_id uuid not null references ashwini.meals on delete cascade,
  ts timestamptz not null default now(),
  field text not null,
  prior_value text,
  new_value text,
  prompt text
);

create table ashwini.symptoms (
  symptom_id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  -- The user's own wording, retained verbatim. PRD 4.4: a route-out should let
  -- the user show exactly what they reported rather than reconstruct it.
  text text not null,
  body_region text,
  message_id uuid references ashwini.messages on delete set null,
  routed_to ashwini.route_destination
);
create index symptoms_ts_idx on ashwini.symptoms (ts desc);

-- PRD 4.2 needs known commitments to answer "what matters next" and to compute
-- the time until it. The prototype hardcoded "4h 12m"; this is the source.
create table ashwini.commitments (
  commitment_id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz,
  domain ashwini.domain not null,
  title text not null,
  detail text,
  kind text not null check (kind in ('training', 'meal', 'dose', 'review', 'capture', 'other')),
  decision_id uuid references ashwini.decisions
);
create index commitments_starts_idx on ashwini.commitments (starts_at);

create table ashwini.training_sessions (
  session_id uuid primary key default gen_random_uuid(),
  ts timestamptz not null,
  planned boolean not null default true,
  completed boolean not null default false,
  kind text,
  volume_note text,
  perceived_effort smallint check (perceived_effort between 1 and 10),
  notes text,
  commitment_id uuid references ashwini.commitments
);
create index training_sessions_ts_idx on ashwini.training_sessions (ts desc);

-- PRD 6.2: micro-tests.
--
-- ashwini.experiments (from the core migration) is intervention-keyed and has
-- no time-to-effect, review point, or stop boundary, so PRD 6.2's six required
-- fields need their own table rather than a stretched one.
--
-- min_comparable_n is the mechanism behind PRD 4.6: "It must not call a result
-- after two days merely because two days look promising." Without a declared
-- minimum, "enough evidence" is decided after the fact by whoever is looking.

create table ashwini.routines (
  routine_id uuid primary key default gen_random_uuid(),
  name text not null,
  domain ashwini.domain not null,
  status ashwini.routine_status not null default 'candidate',

  -- The six PRD 6.2 fields.
  behavior text not null,              -- a single behaviour to repeat or compare
  target text not null,                -- the outcome the user cares about
  expected_lag text not null,          -- expected time-to-effect
  review_at timestamptz,               -- the stated review point
  confound_ids text[] not null default '{}', -- what makes a window unreadable
  stop_boundary text,                  -- stop / route-out condition

  -- PRD 6.3: declared in advance, not chosen once the data is in.
  comparator text,
  interpretation_threshold text,
  min_comparable_n integer not null default 6 check (min_comparable_n > 0),
  eligible_when text,

  started_on date,
  concluded_on date,

  -- PRD 11.6 / 6.3: prescription medication is permanently ineligible.
  is_medication_variable boolean not null default false,
  constraint prescriptions_are_never_routine_variables check (
    is_medication_variable = false
  )
);

create table ashwini.routine_occurrences (
  occurrence_id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references ashwini.routines on delete cascade,
  ts timestamptz not null,
  performed boolean not null,
  -- "5 of 6 comparable sessions" is a query only if comparability is recorded
  -- per occurrence rather than asserted at review time.
  comparable boolean not null default true,
  exclusion_reason text,
  gate_outcome ashwini.gate_outcome,
  linked_record jsonb,
  constraint excluded_occurrences_say_why check (
    comparable or exclusion_reason is not null
  )
);
create index routine_occurrences_routine_idx
  on ashwini.routine_occurrences (routine_id, ts desc);

create table ashwini.routine_reviews (
  review_id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references ashwini.routines on delete cascade,
  reviewed_ts timestamptz not null default now(),
  evidence_status ashwini.evidence_status not null,
  n_with integer not null default 0,
  n_without integer not null default 0,
  n_excluded integer not null default 0,
  summary text not null,
  refused text not null,
  decision_id uuid references ashwini.decisions
);

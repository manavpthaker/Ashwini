-- PRD 8: the confound and evidence gate.
--
-- "Thresholds are not assumed; they must be specified by domain and versioned
-- before implementation."
--
-- Taken literally: thresholds are rows, carrying a version, and changing one is
-- a migration rather than an edited constant. domain/gate.ts is only the
-- resolution rule over these.

create table ashwini.confound_definitions (
  confound_id text primary key,
  label text not null,
  domains ashwini.domain[] not null,
  -- Present ⇒ blocked. Otherwise present ⇒ caveated.
  blocking boolean not null,
  -- Whether an unknown state blocks. PRD 8 lists "Incomplete source data" as a
  -- confound in its own right: for these, not knowing is not the same as fine.
  required_for_verdict boolean not null default false,
  threshold jsonb not null default '{}',
  version text not null,
  active boolean not null default true
);

create table ashwini.confound_evaluations (
  eval_id uuid primary key default gen_random_uuid(),
  confound_id text not null references ashwini.confound_definitions,
  subject_kind text not null check (subject_kind in ('decision', 'routine_review', 'window')),
  subject_id uuid,
  evaluated_ts timestamptz not null default now(),
  state ashwini.confound_state not null,
  detail text,
  window_start timestamptz,
  window_end timestamptz
);
create index confound_evaluations_subject_idx
  on ashwini.confound_evaluations (subject_kind, subject_id);

-- PRD 8's seven confound classes, seeded at version 2026-08-29.
--
-- Blocking vs caveating is the judgement call here, and it follows PRD 8's own
-- framing: things that make a window unreadable block; things that merely add
-- uncertainty caveat, because outcome 2 explicitly allows "a low-risk,
-- reversible recommendation while naming the uncertainty".
insert into ashwini.confound_definitions
  (confound_id, label, domains, blocking, required_for_verdict, threshold, version)
values
  ('sleep_debt', 'Sleep debt',
   '{training,nutrition,focus}', false, false,
   '{"hours_below_baseline": 1.5, "window_nights": 3}', '2026-08-29'),

  ('illness', 'Illness',
   '{training,nutrition,medication,body,focus}', true, false,
   '{"any_reported_illness_in_window": true}', '2026-08-29'),

  ('travel', 'Travel',
   '{training,nutrition,body,focus}', true, false,
   '{"timezone_shift_hours": 3}', '2026-08-29'),

  ('alcohol', 'Alcohol',
   '{training,nutrition,focus}', false, false,
   '{"units_in_window": 4}', '2026-08-29'),

  ('schedule_disruption', 'Unusual schedule',
   '{training,nutrition,focus}', false, false,
   '{"sessions_moved": 2}', '2026-08-29'),

  ('multiple_interventions', 'More than one active intervention',
   '{training,nutrition,body,focus}', true, false,
   '{"max_concurrent": 1}', '2026-08-29'),

  ('incomplete_source_data', 'Incomplete source data',
   '{training,nutrition,medication,body,focus}', true, true,
   '{"min_covered_fraction": 0.8}', '2026-08-29'),

  ('adherence_below_threshold', 'Medication adherence below threshold',
   '{medication,training,nutrition,body,focus}', true, true,
   '{"min_adherence_fraction": 0.8}', '2026-08-29'),

  ('confounding_medication_change', 'Change in a system-wide medication class',
   '{training,nutrition,body,focus}', true, false,
   '{"gap_days": 2, "counts_start_stop_or_dose_change": true}', '2026-08-29'),

  ('capture_quality', 'Capture standardisation',
   '{body}', true, true,
   '{"min_alignment_score": 0.8, "requires_color_card": true}', '2026-08-29');

comment on table ashwini.confound_definitions is
  'PRD 8. Thresholds are versioned data. Change one with a new migration and a new version string; never edit a row in place, because stored decisions cite the version that produced them.';

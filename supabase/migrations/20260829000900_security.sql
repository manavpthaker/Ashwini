-- Two guarantees this migration makes structural rather than procedural:
-- append-only history, and no PostgREST reachability.

-- ---------------------------------------------------------------------------
-- Append-only history
--
-- PRD 8 requires a user override to be "permanently retained with the output it
-- affected"; PRD 9 requires a decision to remain answerable later. Both die
-- quietly the first time someone runs an UPDATE to "fix" a row. Enforced with a
-- trigger rather than role grants so it holds no matter which role connects,
-- including a psql session opened by hand at 1am.
-- ---------------------------------------------------------------------------

create or replace function ashwini.refuse_mutation() returns trigger
language plpgsql as $$
begin
  raise exception
    'ashwini.% is append-only; % is refused. Record a new row (decisions.supersedes, messages.corrected_by) instead of rewriting history.',
    tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

-- A correction sets the forward pointer on the message it replaces, so messages
-- need exactly one mutable column and no others.
create or replace function ashwini.refuse_mutation_except_correction() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ashwini.messages is append-only; DELETE is refused.'
      using errcode = 'restrict_violation';
  end if;

  -- Compare every column except corrected_by. If any of them moved, this is a
  -- rewrite rather than a correction.
  if row(new.message_id, new.ts, new.role, new.text, new.kind, new.receipt,
         new.in_reply_to, new.advisor_version, new.rule_id, new.idempotency_key,
         new.captured_at)
     is distinct from
     row(old.message_id, old.ts, old.role, old.text, old.kind, old.receipt,
         old.in_reply_to, old.advisor_version, old.rule_id, old.idempotency_key,
         old.captured_at)
  then
    raise exception
      'ashwini.messages is append-only except for corrected_by; record a correction as a new message.'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger decisions_append_only
  before update or delete on ashwini.decisions
  for each row execute function ashwini.refuse_mutation();

create trigger decision_responses_append_only
  before update or delete on ashwini.decision_responses
  for each row execute function ashwini.refuse_mutation();

create trigger decision_outcomes_append_only
  before update or delete on ashwini.decision_outcomes
  for each row execute function ashwini.refuse_mutation();

create trigger therapy_mentions_append_only
  before update or delete on ashwini.therapy_mentions
  for each row execute function ashwini.refuse_mutation();

create trigger dermatology_handoffs_append_only
  before update or delete on ashwini.dermatology_handoffs
  for each row execute function ashwini.refuse_mutation();

create trigger confound_evaluations_append_only
  before update or delete on ashwini.confound_evaluations
  for each row execute function ashwini.refuse_mutation();

create trigger external_results_append_only
  before update or delete on ashwini.external_results
  for each row execute function ashwini.refuse_mutation();

create trigger messages_append_only
  before update or delete on ashwini.messages
  for each row execute function ashwini.refuse_mutation_except_correction();

-- ---------------------------------------------------------------------------
-- No PostgREST reachability
--
-- The schema already sits outside `public`, which is the real control: Supabase
-- only exposes `public` plus whatever is added to Exposed Schemas. RLS is the
-- second layer, so that adding `ashwini` to Exposed Schemas by accident still
-- yields nothing to anon or authenticated.
--
-- Tables are enabled with NO policies, which denies everything. The application
-- connects over Postgres directly as a role with BYPASSRLS or as the owner.
-- ---------------------------------------------------------------------------

do $$
declare
  target record;
begin
  for target in
    select tablename from pg_tables where schemaname = 'ashwini'
  loop
    execute format('alter table ashwini.%I enable row level security', target.tablename);
    execute format('alter table ashwini.%I force row level security', target.tablename);
  end loop;
end;
$$;

revoke all on schema ashwini from public;
revoke all on all tables in schema ashwini from public;

comment on schema ashwini is
  'Private health records. Kept out of `public` so Supabase PostgREST does not serve it, and RLS-denied as a second layer. Do not add this schema to the project Exposed Schemas.';

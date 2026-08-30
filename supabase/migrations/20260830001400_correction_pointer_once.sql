-- A message correction is a one-way forward pointer. Repointing it would make
-- an earlier correction current again and silently rewrite the effective
-- record. The service also checks corrected_by is null, but this invariant must
-- hold for every direct SQL writer.

create or replace function ashwini.refuse_mutation_except_correction() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ashwini.messages is append-only; DELETE is refused.'
      using errcode = 'restrict_violation';
  end if;

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

  if old.corrected_by is not null then
    raise exception 'ashwini.messages corrected_by is already set and cannot be repointed.'
      using errcode = 'restrict_violation';
  end if;

  if new.corrected_by is null or new.corrected_by = old.message_id then
    raise exception 'ashwini.messages corrected_by must point once to a different message.'
      using errcode = 'restrict_violation';
  end if;

  if not exists (
    select 1
    from ashwini.messages as correction
    where correction.message_id = new.corrected_by
      and correction.role = 'user'
  ) then
    raise exception 'ashwini.messages corrected_by must point to a user message.'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

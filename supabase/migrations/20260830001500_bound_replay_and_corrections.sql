-- Bind an idempotent replay to the exact input with a server-peppered HMAC,
-- without retaining protected raw wording, and make the correction graph
-- one-way and one-to-one in Postgres.

alter table ashwini.messages
  add column input_fingerprint text
  check (input_fingerprint is null or input_fingerprint ~ '^[0-9a-f]{64}$');

create unique index messages_corrected_by_once_idx
  on ashwini.messages (corrected_by)
  where corrected_by is not null;

create or replace function ashwini.refuse_mutation_except_correction() returns trigger
language plpgsql as $$
declare
  target_role ashwini.message_role;
  target_corrected_by uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'ashwini.messages is append-only; DELETE is refused.'
      using errcode = 'restrict_violation';
  end if;

  if row(new.message_id, new.ts, new.role, new.text, new.kind, new.receipt,
         new.in_reply_to, new.advisor_version, new.rule_id, new.idempotency_key,
         new.input_fingerprint, new.captured_at)
     is distinct from
     row(old.message_id, old.ts, old.role, old.text, old.kind, old.receipt,
         old.in_reply_to, old.advisor_version, old.rule_id, old.idempotency_key,
         old.input_fingerprint, old.captured_at)
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

  select correction.role, correction.corrected_by
    into target_role, target_corrected_by
    from ashwini.messages as correction
   where correction.message_id = new.corrected_by;

  if target_role is distinct from 'user'::ashwini.message_role then
    raise exception 'ashwini.messages corrected_by must point to a user message.'
      using errcode = 'restrict_violation';
  end if;

  if target_corrected_by is not null then
    raise exception 'ashwini.messages correction target is already superseded.'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

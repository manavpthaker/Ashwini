-- Persist the output fields needed for an exact idempotent replay. Existing
-- replies stay unchanged; their unknown historical metadata remains null.
alter table ashwini.messages
  add column reply_metadata jsonb
  check (
    reply_metadata is null or (
      role = 'ashwini'::ashwini.message_role
      and jsonb_typeof(reply_metadata) = 'object'
      and reply_metadata->'version' = '1'::jsonb
      and reply_metadata ?& array['version', 'followUp', 'trace']
      and reply_metadata - array['version', 'followUp', 'trace'] = '{}'::jsonb
      and jsonb_typeof(reply_metadata->'trace') = 'object'
      and jsonb_typeof(reply_metadata->'trace'->'ruleId') = 'string'
      and reply_metadata->'trace'->>'ruleId' = rule_id
      and (reply_metadata->'trace') - array['ruleId', 'mode', 'reason'] = '{}'::jsonb
      and (not (reply_metadata->'trace' ? 'mode') or
        reply_metadata->'trace'->>'mode' in ('rules_only', 'model', 'model_unavailable'))
      and (not (reply_metadata->'trace' ? 'reason') or
        reply_metadata->'trace'->>'reason' in (
          'not_configured', 'terminal_rule', 'provider_auth', 'provider_rate_limit',
          'provider_error', 'timeout', 'network', 'invalid_output',
          'unsupported_provenance', 'research_error'))
      and (reply_metadata->'followUp' = 'null'::jsonb
        or (jsonb_typeof(reply_metadata->'followUp') = 'string'
          and char_length(reply_metadata->>'followUp') <= 250))
    ) is true
  );

comment on column ashwini.messages.reply_metadata is
  'Versioned generated followUp and allowlisted trace only. Never raw check-in text, provider errors, credentials or a second clinical record.';

-- Extend the existing immutable-column comparison without changing the
-- write-once correction-pointer constraints from migration 015.
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
         new.input_fingerprint, new.captured_at, new.reply_metadata)
     is distinct from
     row(old.message_id, old.ts, old.role, old.text, old.kind, old.receipt,
         old.in_reply_to, old.advisor_version, old.rule_id, old.idempotency_key,
         old.input_fingerprint, old.captured_at, old.reply_metadata)
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

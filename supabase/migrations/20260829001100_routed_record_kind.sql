-- PRD 4.3 promises Ashwini "shows what it recorded or changed", and the check-in
-- screen now renders that list on first response and again after a reload. The
-- two disagreed.
--
-- Two causes, one fix. A record kind with no dedicated table — a medication
-- event, a context note, an interaction check request — wrote no routed_records
-- row at all, because there was nothing for record_id to point at; the message
-- itself is the record. And for the kinds that do have a table, the read path
-- had to reverse-map "dermatology_handoffs" back to "dermatology_handoff",
-- which put a naming convention in charge of a display decision.
--
-- Storing the kind fixes both: it is what the interface actually asks for, and
-- it lets a message-only record be recorded as one.

alter table ashwini.routed_records
  add column record_kind text;

-- Backfill from the table name, which is all the earlier rows carry.
update ashwini.routed_records
set record_kind = case record_table
  when 'symptoms' then 'symptom'
  when 'meals' then 'meal'
  when 'dermatology_handoffs' then 'dermatology_handoff'
  when 'therapy_mentions' then 'therapy_mention'
  else 'context_note'
end
where record_kind is null;

alter table ashwini.routed_records
  alter column record_kind set not null;

-- A message-only record points at the message it is. Nothing else in the schema
-- would let record_id stay non-null and honest.
comment on column ashwini.routed_records.record_kind is
  'The advisor RecordDraft kind. Where a kind has no table of its own, record_table is ''messages'' and record_id is the message itself.';

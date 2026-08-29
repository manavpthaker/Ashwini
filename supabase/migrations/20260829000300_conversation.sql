-- PRD 4.3: one conversational intake.
--
-- The point of routed_records is PRD 4.3's promise that Ashwini "shows what it
-- recorded or changed". Without it that claim is a story; with it, it is a join.

create table ashwini.messages (
  message_id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  role ashwini.message_role not null,
  text text not null,
  kind ashwini.message_kind,
  receipt text,
  in_reply_to uuid references ashwini.messages,
  -- PRD 4.3 keeps corrections. Superseding is non-destructive: the original row
  -- stays and points forward, so the history of what Ashwini believed survives.
  corrected_by uuid references ashwini.messages,
  advisor_version text,
  rule_id text,
  -- Client-generated, so an offline-queued write replayed twice lands once.
  idempotency_key text unique,
  -- Distinct from ts: when the user captured it vs when the server received it.
  captured_at timestamptz
);
create index messages_ts_idx on ashwini.messages (ts desc);

create table ashwini.attachments (
  attachment_id uuid primary key default gen_random_uuid(),
  message_id uuid not null references ashwini.messages on delete cascade,
  kind text not null check (kind in ('image', 'document')),
  -- Supabase Storage object path in a private bucket. PRD 11.2: photos stay
  -- private except for the minimum images an authorised analysis needs.
  storage_path text not null,
  mime_type text not null,
  bytes integer,
  sha256 text,
  capture_id uuid references ashwini.captures,
  doc_id uuid references ashwini.documents
);
create index attachments_message_idx on ashwini.attachments (message_id);

-- The audit trail for "Ashwini decides whether the input becomes a meal
-- estimate, adherence event, symptom note, training result, question, document,
-- or specialist-handoff item" (PRD 4.3).
create table ashwini.routed_records (
  message_id uuid not null references ashwini.messages on delete cascade,
  record_table text not null,
  record_id uuid not null,
  primary key (message_id, record_table, record_id)
);

-- PRD 11.9: therapy content is inert and is not stored. Only the fact that a
-- session was mentioned is retained, so it can act as context for burden and
-- scheduling without ever becoming an inference source.
create table ashwini.therapy_mentions (
  mention_id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  message_id uuid references ashwini.messages on delete set null
);

comment on table ashwini.therapy_mentions is
  'PRD 11.9. Deliberately has no text column. Do not add one.';

-- PRD 11.8: critical dose reminders must not depend on a single machine.
--
-- The dispatch log is what makes a reminder idempotent and auditable: it says
-- what went out, when, through which channel, and whether it landed. Without
-- it, a scheduler that runs twice reminds twice — and duplicate nagging about
-- medication is not a cosmetic bug.
--
-- Append-only, like the rest of the record.

create type ashwini.reminder_channel as enum ('brownbot', 'log');
create type ashwini.reminder_status as enum ('sent', 'failed', 'skipped');

create table ashwini.reminder_dispatches (
  dispatch_id uuid primary key default gen_random_uuid(),
  dose_id uuid not null references ashwini.doses on delete cascade,
  -- The occurrence this reminder is for. Together with dose_id it is unique, so
  -- a scheduler running twice for the same slot cannot send twice.
  scheduled_for timestamptz not null,
  dispatched_at timestamptz not null default now(),
  channel ashwini.reminder_channel not null,
  status ashwini.reminder_status not null,
  -- Delivery detail: a provider message id on success, the error on failure.
  detail text,
  unique (dose_id, scheduled_for)
);

create index reminder_dispatches_dose_idx
  on ashwini.reminder_dispatches (dose_id, scheduled_for desc);

comment on table ashwini.reminder_dispatches is
  'PRD 11.8. Append-only dispatch log. The (dose_id, scheduled_for) unique constraint is the idempotency guarantee — a re-run of the scheduler cannot double-send.';

alter table ashwini.reminder_dispatches enable row level security;
alter table ashwini.reminder_dispatches force row level security;

create trigger reminder_dispatches_append_only
  before update or delete on ashwini.reminder_dispatches
  for each row execute function ashwini.refuse_mutation();

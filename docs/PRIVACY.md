# Privacy and data handling

PRD §4.8 requires encryption, backup, retention, access control, offline-data
handling, and model-provider disclosure to be **defined before personal data is
ingested**. This document is that definition. It describes what is true today,
and marks plainly what is not yet done — an unresolved control listed honestly is
worth more than one that reads as finished.

Nothing in this repository is real health data. The repository is public; the
records are not, and must never be committed to it.

## What is stored, and where

| | |
|---|---|
| **Application** | Vercel (managed hosting), publicly reachable |
| **Canonical records** | Supabase (managed Postgres), `ashwini` schema |
| **Capture images and documents** | Supabase Storage, private buckets |
| **Access** | A verified session on an explicit allowlist |
| **Scheduled work** | Vercel Cron |

Two amendments moved this away from the PRD's original topology: v0.5 moved
canonical data off the Mac mini, and v0.6 moved the application itself onto
public hosting. See PRD §4.8 for both, and the trade accepted in each.

**A private deployment is still fully supported.** Running on the Mac mini
behind `tailscale serve` needs no code change — the identity gate switches mode
on what is configured. The controls below describe the hosted deployment, which
is the stricter case.

**There are two processors, not one.** Supabase holds the records; Vercel runs
the code that reads them and therefore sees them in memory and in logs. Both are
subject to their own encryption, retention, and operational access. That is the
cost of managed backups, availability, and a scheduler that fires whether or not
a machine at home is awake — disclosed here rather than buried.

## Access control

Three independent layers. The application is publicly reachable, so these are
the whole of the protection — there is no network position doing quiet work
behind them:

1. **Session.** Every request must carry a Supabase session, verified with
   `getUser()` — never `getSession()`, which only reads the cookie without
   validating it and so cannot decide whether to admit anyone. Sign-in is a
   magic link with `shouldCreateUser: false`: there is no sign-up here, only the
   owner signing in.
2. **Allowlist.** A verified session is not enough. The address must appear in
   `ASHWINI_ALLOWED_EMAILS`, because any account able to sign in to the same
   Supabase project would otherwise be admitted. The allowlist is what makes
   this single-subject, and the app treats an empty one as "no auth configured"
   rather than "allow everyone".

   *On a private deployment* these two are replaced by the tailnet identity
   header, which is sound **only** because `tailscale serve` injects it and
   nothing else can reach the port. The application refuses that mode on a
   public host, with no override.

3. **Database.** Health tables live in the `ashwini` schema, not `public`.
   Supabase serves `public` over PostgREST at a public URL, so schema isolation
   is a real control and not tidiness. The schema must **not** be added to the
   project's Exposed Schemas. Row-level security is enabled and forced on every
   table with no permissive policies, so even a misconfiguration there yields
   nothing to the publishable key or its legacy anon-key equivalent.

## Encryption

- **In transit:** TLS to the application (Vercel-managed, or Tailscale-issued on
  a private deployment) and TLS to Supabase. Certificate verification is never
  disabled.
- **At rest:** Supabase-managed encryption for database and storage.
- **Backups:** encrypted at rest on the backup volume (see below).
- **Device:** FileVault on the Mac mini.

## Backup, retention, and deletion

- Supabase provides managed backups; point-in-time recovery depends on plan
  tier and should be confirmed against the project's actual settings.
- **An independent `pg_dump` runs on a schedule to an encrypted local volume.**
  Managed backups you cannot restore yourself are not a record you own.
- **The restore must be rehearsed, not assumed.** A backup that has never been
  restored is a hypothesis.
- Retention: records are kept indefinitely by default. This is a single-subject
  longitudinal record and its value is its length.
- Deletion: the owner may delete anything. Note the tension with the
  append-only guarantee below — deletion is a deliberate, manual act against the
  database, not something the application offers as a button.

## Append-only history

`decisions`, `decision_responses`, `decision_outcomes`, `messages`,
`therapy_mentions`, `dermatology_handoffs`, `confound_evaluations` and
`external_results` refuse `UPDATE` and `DELETE` at the database level.

This is enforced by trigger rather than by role grants, so it holds regardless
of which role connects — including a `psql` session opened by hand.

It exists because PRD §8 requires an override to be "permanently retained with
the output it affected", and PRD §9 requires a decision to remain answerable
later. Both die the first time someone tidies a row. A correction is a new row:
`decisions.supersedes` points backwards, `messages.corrected_by` points forwards,
and `messages.corrected_by` is the single column any of these tables permits to
change.

## Model-provider disclosure

**No model provider is in use.** The advisor is deterministic — an ordered rule
pipeline in `domain/advisor/`, stamped onto every stored decision as
`advisor_version` and `rule_id`.

No health data has been sent to any inference provider. When that changes, PRD
§4.8 requires the provider to be disclosed and the boundary opted into before
personal data reaches it, and the `advisor_version` on every historical decision
is what keeps rule-era records from being silently reinterpreted by a model.

## Offline data handling

- Writes queued offline carry a client-generated `idempotency_key`, unique in
  the database, so a replayed write lands exactly once.
- `captured_at` (when the user recorded it) is stored separately from `ts` (when
  the server received it). A late-arriving record must re-run the confound gate
  rather than inherit a verdict computed without it.
- Reads are never served stale. Health data is network-only; when the app cannot
  reach the server it must say so rather than render old records as current.

## What is excluded from inference

- **Therapy content** (PRD §11.9). `ashwini.therapy_mentions` records that a
  session occurred and has no column capable of holding its text. The `sources`
  table carries a `Therapy notes` row marked `excluded`, so the exclusion is a
  database fact rather than a comment.
- **Skin marks** (PRD §11.4). Moles, lesions, and pigmented spots are documented
  and routed to dermatology, never analysed. `dermatology_handoffs` holds the
  user's own wording and deliberately has no assessment field.

## Time-critical reminders

PRD §11.8 requires that critical dose reminders not depend on a single machine.
Hosted deployment answers this directly: Vercel Cron fires the scheduler
regardless of whether the Mac mini is awake or the tailnet is reachable. This
was the main thing the private-only topology could not deliver, and it is a
large part of why v0.6 accepted public hosting.

Reminder metadata — that a dose is due, and which medication — reaches the
delivery channel by necessity. Choosing that channel is choosing another
processor, and it belongs in this document once one is wired.

Two properties hold regardless of channel:

- A dose already taken, skipped, or reminded about is never reminded again, and
  the `(dose_id, scheduled_for)` unique constraint enforces that rather than
  application care.
- An undelivered reminder is recorded as failed, never as sent. A delivery that
  did not happen must not read as one.

## Unresolved

Honest gaps, not oversights:

1. **Key recovery.** Encryption at rest is the processor's; there is no
   documented recovery path for the independent backup volume's key.
2. **Capture-image lifecycle.** Signed-URL expiry, retention, and deletion for
   Supabase Storage objects are not yet specified.
3. **Restore rehearsal.** Not yet performed. Until it is, the backup story is
   theoretical.
4. **Reminder delivery channel.** The scheduler runs and the dispatch log is
   append-only, but no channel is wired yet. The placeholder records
   `status: "failed"` rather than `"sent"`, so an undelivered reminder is
   visible rather than silently marked delivered.

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
| **Application** | One Node process on the private host. No public ingress. |
| **Canonical records** | Supabase (managed Postgres), `ashwini` schema |
| **Capture images and documents** | Supabase Storage, private buckets |
| **Reachability** | Tailscale only, via `tailscale serve` |

This is an amendment to the PRD's original topology, in which the Mac mini held
canonical data. See PRD §4.8 (v0.5) for the reasoning and the trade accepted.

**Supabase is a data processor.** Personal health records rest on their
infrastructure, subject to their encryption at rest and their operational
access. That is the cost of managed backups and recovery, and it is disclosed
here rather than buried.

## Access control

Three independent layers, because "no public ingress" is not "no access":

1. **Network.** `tailscale serve` terminates TLS and admits only tailnet
   traffic. `tailscale funnel` is **prohibited** — it is public ingress and
   violates PRD §11.3. The application binds to `127.0.0.1`, so nothing on the
   local network can reach it directly and bypass the layers below.
2. **Identity.** `proxy.ts` requires a `Tailscale-User-Login` header matching
   `ASHWINI_TAILSCALE_USER` on every request. Every node on a tailnet can reach
   the host; a shared tailnet would otherwise put the record one request away.
   The tailnet ACL should independently restrict port 443 on this node.
3. **Database.** Health tables live in the `ashwini` schema, not `public`.
   Supabase serves `public` over PostgREST at a public URL, so schema isolation
   is a real control and not tidiness. The schema must **not** be added to the
   project's Exposed Schemas. Row-level security is enabled and forced on every
   table with no permissive policies, so even a misconfiguration there yields
   nothing to the anon key.

## Encryption

- **In transit:** TLS to the application (Tailscale-issued certificate) and TLS
  to Supabase. Certificate verification is never disabled.
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

## Unresolved

Honest gaps, not oversights:

1. **Time-critical medication reminders.** PRD §11.8 requires these not to
   depend solely on one machine, and §7.3 wants a reliable native iOS mechanism.
   A PWA cannot provide one: the web has no scheduled local notification, so a
   reminder must be pushed — meaning the host must be awake and must reach
   Apple's push service, which puts reminder metadata outside the private
   network. iOS web push also drops subscriptions across device restarts. Either
   a companion mechanism owns dose reminders, or the product states that it does
   not deliver them.
2. **Key recovery.** Encryption at rest is the processor's; there is no
   documented recovery path for the independent backup volume's key.
3. **Capture-image lifecycle.** Signed-URL expiry, retention, and deletion for
   Supabase Storage objects are not yet specified.
4. **Restore rehearsal.** Not yet performed. Until it is, the backup story is
   theoretical.

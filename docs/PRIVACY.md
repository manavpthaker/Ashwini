# Privacy and data handling

PRD §4.8 requires encryption, backup, retention, access control, offline-data
handling, and model-provider disclosure to be **defined before personal data is
ingested**. This document is that definition. It describes what is true today,
and marks plainly what is not yet done — an unresolved control listed honestly is
worth more than one that reads as finished.

Nothing in this repository is real health data. The repository is public; the
records are not, and must never be committed to it.

## What is stored, and where

|                                  |                                               |
| -------------------------------- | --------------------------------------------- |
| **Application**                  | Vercel (managed hosting), publicly reachable  |
| **Canonical records**            | Supabase (managed Postgres), `ashwini` schema |
| **Capture images and documents** | Supabase Storage, private buckets             |
| **Access**                       | A verified session on an explicit allowlist   |
| **Scheduled work**               | Vercel Cron                                   |

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
   this single-subject. Until rows carry tenant ownership, the application
   requires exactly one distinct address and fails closed on either zero or
   multiple addresses.

   _On a private deployment_ these two are replaced by the tailnet identity
   header, which is sound **only** because `tailscale serve` injects it and
   nothing else can reach the port. The application refuses that mode on a
   public host, with no override.

3. **Database.** Health tables live in the `ashwini` schema, not `public`.
   Supabase serves `public` over PostgREST at a public URL, so schema isolation
   is a real control and not tidiness. The schema must **not** be added to the
   project's Exposed Schemas. Row-level security is enabled with no permissive
   policies, so the publishable key or its legacy anon-key equivalent cannot
   read these tables through PostgREST. It is deliberately **not forced**:
   Ashwini's server-only database-owner connection must be able to operate the
   single-owner record after the application authenticates and allowlists the
   request. That server credential therefore remains a high-trust boundary.

## Encryption

- **In transit:** TLS to the application (Vercel-managed, or Tailscale-issued on
  a private deployment) and TLS to Supabase. Remote PostgreSQL connections
  verify both the hostname and the chain against the project CA supplied in the
  server-only `ASHWINI_POSTGRES_CA`; missing CA configuration fails closed.
- **At rest:** Supabase-managed encryption for database and storage.
- **Backups:** Supabase-managed encryption applies to managed backups. An
  independently controlled backup has not been verified yet.
- **Device:** FileVault on the Mac mini.

## Backup, retention, and deletion

- Supabase provides managed backups; point-in-time recovery depends on plan
  tier and should be confirmed against the project's actual settings.
- **An independent `pg_dump` to an encrypted local volume is required but not
  verified as running.** Managed backups you cannot restore yourself are not a
  record you own.
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

**Rules-only is the default. OpenAI is an optional, explicitly opted-in processor.**
The application requires all of `OPENAI_API_KEY`, `ASHWINI_MODEL` and
`ASHWINI_MODEL_CONTEXT_CONSENT=openai-v1` before model inference. A key alone is
not consent. Set the consent variable only after the owner agrees to this
disclosure; never infer it from an existing account or model credential. Health
context shows configuration status, not a claim that a live model test passed.

When enabled, the server sends the current check-in and selected historical
assertions, recent uncorrected non-protected check-ins and their advisor replies,
routines, active medication and supplement identities, relevant daily records,
and bounded imported observations and dated summaries to OpenAI's Responses API.
Wearable retrieval covers 22 explicit priority metrics independently; source/device
separation, dates, missing metrics, stale samples and partial coverage remain
visible. Sleep summaries describe calendar days, not inferred nightly sleep;
sample averages are not time-weighted. Model payloads include representative
sample IDs; a cited summary expands to all contributing sample references in the
durable decision record, and its identity binds the exact inputs and aggregation.
Source filesystem paths are omitted from
the model payload. The full raw source repository, raw Apple Health XML, therapy
narratives, photos and documents are not sent. Recognized terminal safety routes
run before external calls. Selected source assertions remain untrusted data, not
instructions. The model cannot directly update medication schedules or turn its
own estimates into recorded measurements.

Requests use `store:false`, no provider conversation store and no raw request or
response logging. This is **not a promise of zero provider retention**: OpenAI's
abuse-monitoring policies may still apply. API content is not used for model
training by default. Review the current [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)
before enabling. Request timeout is 25 seconds and output is capped at 4,500
tokens; account spending limits remain the owner's responsibility. Context and
advisor diagnostics record only fixed reason codes, elapsed time and aggregate
counts, never check-in text, health values, source IDs or raw provider errors.
Check-in route failures log fixed operation codes, not database error contents.
No API key is
bundled into the client. Failures return visibly labeled rules-only guidance.

Europe PMC receives only general search topics selected from a fixed vocabulary,
never raw check-ins, profile statements, identifiers or model-generated queries.
Retrieved abstracts are used transiently; stored provenance is bibliographic
metadata and the query topic, not full copyrighted abstracts. Public literature
does not become a current interaction clearance. Historical decisions retain
their `advisor_version`, `rule_id`, cited source IDs and rendered source links.

### Imported personal context

Curated source versions and assertions live in `health_context_sources` and
`health_context_entries`. Raw documents are not copied into the database.
Hashes, locators, source date precision and curation revisions retain provenance.
These tables and Apple Health import/observation tables enable deny-by-default
RLS and refuse update/delete, preserving older versions. An explicit new source
version supersedes the old version for retrieval; it does not rewrite history.
Imported medications/supplements remain historical context pending confirmation,
not active prescriptions or adherence. Retention and owner deletion use the same
policy as the rest of the private record.

Local import payloads/exports belong only in the ignored `private/` directory or
another owner-private location, never Git, fixtures or public attachments. Source
documents are reviewed as data: examples, generic instructions and therapy
narratives are excluded. The import's explicit no-therapy declaration records the
curation requirement, not a claim of infallible automatic narrative detection.

Apple Health import supports dated records/workouts, not native live sync. Source
device/app, units, offsets, batch provenance and cross-export deduplication remain
intact. Route coordinates and raw clinical documents are excluded. A separate
bounded FHIR adapter can curate structured lab/vital observations, conditions,
medication orders, immunizations, allergies and procedures into dated health
context. It omits narratives, notes, attachments and patient identifiers;
source-coded statuses do not establish current diagnoses or medication use.
Source units, ranges and interpretation flags remain source assertions, not
new clinical judgments. Latest values remain dated observations. Bounded summaries
disclose their aggregation and incomplete coverage; they are not evidence of live
monitoring, complete daily totals or causal trends.
Do not enable external model use of HealthKit-derived context without owner
permission for that processing. See [Apple Health import](APPLE_HEALTH.md).

## Offline data handling

- There is no general offline queue yet. For an uncertain browser write, the
  client retains only a SHA-256 intent fingerprint and its idempotency key in
  session storage. An unchanged retry—also after reload—reuses that key, while
  the database uniqueness constraint makes the replay land once. The check-in
  wording itself is not written to browser storage.
- `captured_at` (when the user recorded it) is stored separately from `ts` (when
  the server received it). A late-arriving record must re-run the confound gate
  rather than inherit a verdict computed without it.
- Reads are never served stale. Health data is network-only; when the app cannot
  reach the server it must say so rather than render old records as current.

## What is excluded from inference

- **Therapy content** (PRD §11.9). Classification happens before persistence.
  `ashwini.messages` receives only “Therapy session mentioned · content not
  retained”, while `ashwini.therapy_mentions` records that a session occurred
  and has no column capable of holding its text. The `sources` table carries a
  `Therapy notes` row marked `excluded`, so the exclusion is a database fact
  rather than a comment.
- **Crisis wording.** Classification likewise happens before persistence;
  `ashwini.messages` retains only “Crisis check-in received · content not
  retained”. The route and timestamp remain, not the wording.
- **Protected replay identity.** Exact retry matching uses a SHA-256 HMAC with
  `ASHWINI_INPUT_HMAC_KEY`, which is server-only and absent from the database.
  A plain content hash is not used because common protected phrases would be
  guessable from a database snapshot.
- **Skin marks** (PRD §11.4). Moles, lesions, and pigmented spots are documented
  and routed to dermatology, never analysed. `dermatology_handoffs` holds the
  user's own wording and deliberately has no assessment field.

## Time-critical reminders

PRD §11.8 requires that critical dose reminders not depend on a single machine.
Vercel Cron removes that dependency from the scheduler tick, but the current
application has no delivery channel. It records a failed placeholder attempt;
it does not send a reminder. Hosted scheduling is a prerequisite, not proof
that §11.8 is satisfied.

Reminder metadata — that a dose is due, and which medication — reaches the
delivery channel by necessity. Choosing that channel is choosing another
processor, and it belongs in this document once one is wired.

Two properties hold in the current placeholder:

- A dose already taken, skipped, or attempted is not selected again. Failed
  attempts are not retried; a real channel needs an explicit retry and
  idempotency design before delivery can be called reliable.
- An undelivered reminder is recorded as failed, never as sent. A delivery that
  did not happen must not read as one.

## Unresolved

Honest gaps, not oversights:

1. **Independent backup.** The required encrypted `pg_dump` schedule has not
   been verified as running.
2. **Key recovery.** Encryption at rest is the processor's; there is no
   documented recovery path for the independent backup volume's key.
3. **Capture-image lifecycle.** Signed-URL expiry, retention, and deletion for
   Supabase Storage objects are not yet specified.
4. **Restore rehearsal.** Not yet performed. Until it is, the backup story is
   theoretical.
5. **Reminder delivery channel.** The scheduler runs and the dispatch log is
   append-only, but no channel is wired yet. The placeholder records
   `status: "failed"` rather than `"sent"`, so an undelivered reminder is
   visible rather than silently marked delivered.

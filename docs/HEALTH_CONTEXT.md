# Longitudinal health context

Health context is available at `/context` from the product's account/footer links.
It shows saved source assertions, dates/unknown dates and whether current status
needs confirmation. It is not a verified clinical chart. Current use of an old
prescription, targets from an old plan and missing allergies must not be guessed.

## Import

Prepare curated JSON matching `lib/health-context.ts`. Keep it outside Git.
Every source has a stable key, raw source SHA-256, label/locator, optional source
date with precision, and curated entries. Source file timestamps or Git dates
are not observation dates. Exclude examples and therapy narratives.

Use Health context → choose JSON → review preview → Import health context.
The owner-authenticated route validates and imports atomically. Alternatively:

```sh
pnpm health:import /absolute/private/context.json
pnpm health:import /absolute/private/context.json --apply
```

CLI defaults to validation-only. Applying requires server-only `DATABASE_URL`
and the verified project CA. Repeating identical source content/revision is
idempotent. Corrected curation of the same raw source increments `revision`;
the new source version supersedes earlier entries without deleting them. An
explicit version with no entries retires a source from future context.

Migrations 16–18 add context, Apple Health observations and the Working hypothesis
evidence status. Apply them before deploying the context reader. Do not seed
synthetic data into the live record. See `APPLE_HEALTH.md` for XML import.

## Reasoning and sources

Each non-terminal check-in loads source-backed history, recent uncorrected
non-protected check-ins with their paired advisor replies, actual active routines
and bounded imported wearable context. History selection ranks question relevance
first, then recorded dates, with diminishing representation by source and category.
The canonical history stays intact; the advisor selects up to 60 assertions and
the model receives up to 12 recent check-ins. Unknown dates and historical plans
do not become current facts through retrieval.

Wearable retrieval uses the existing metric/time index for 22 explicitly supported
metrics. Each metric has its own bounded 14-day window anchored to its latest
record, so a recent step sample cannot hide older sleep or weight data. Per-metric
freshness and truncation are explicit. Dated summaries separate source/device and
unit, union overlapping sleep intervals within a source, and avoid summing
overlapping activity intervals. Sleep hours are recorded **local calendar-day**
duration, not an inferred full night. A sample mean is not a clinical baseline.
`bounded_complete` describes the retrieved record set, not continuous device wear
or complete behavior. Neither these summaries nor latest samples establish a
trend, causality or current symptoms. The export remains a snapshot, not live sync.

Summary identity binds the exact contributing records and computed result. A cited
summary ID expands to the full contributing raw-record references on
the saved decision; only a bounded reference preview goes into provider input.

The rules remain the default and recognized terminal safety routes run before
research or model calls. Rules-only feedback now offers a bounded next step for
lab-record review, focus, sleep, nutrition and broad health-context review, using
relevant dated excerpts and wearable freshness. Lab flags are attributed to the
source record, never independently diagnosed. A recovery hypothesis requires an
affirmed current low-energy report plus an eligible recent poor-sleep self-report;
newer contradictions, corrections or examples cannot be skipped to find support.
These are explicitly labeled local rules, not model or research synthesis.

Ordinary rules-only follow-up answers can resolve a known immediately prior
question about pre-training timing, focus barriers, review priority or meal
consistency. The exchange must be recent (within six hours), receipt-ordered and
the latest eligible actual turn; an intervening protected or corrected check-in
blocks continuation without exposing its text. Only a narrow answer is interpreted.
Old symptom wording is never replayed as a new self-report, and only the user's
actual new words enter the trusted record-extraction path. This is not a general
language-understanding engine; optional model input also includes prior advisor
replies and their dates for broader continuity.

Optional OpenAI reasoning requires all three server-only variables:

- `OPENAI_API_KEY`
- `ASHWINI_MODEL` (a Responses API model supporting structured outputs)
- `ASHWINI_MODEL_CONTEXT_CONSENT=openai-v1` (only after owner opt-in)

The model returns one coordinated next step, up to three provisional hypotheses
with alternatives, uncertainty, one optional question and supplied source IDs.
Unknown IDs/malformed or failed responses fall back to rules with an explicit
status. Clinical routes are not labeled lifestyle hypotheses. The model never
receives permission to write prescriptions, schedules or measurements.
`gpt-6-astra` uses explicit low reasoning effort for bounded first-reply latency;
other configured models are not sent an unverified reasoning parameter. Model
requests have a 25-second timeout. Mode, safe error category, elapsed time and
context counts may be logged; raw check-ins, provider error bodies, secrets and
clinical values are never part of these diagnostic events. A configured model
is not evidence of a successful provider call.

Europe PMC retrieval currently supports seven broad topics: sleep, nutrition,
training, focus, caffeine, fatigue and lab-result interpretation. Focus uses a
general attention/concentration query rather than assuming ADHD. Queries prioritize review literature with
no date/country cutoff. This is deliberately not described as universal research
coverage, a systematic review, independently appraised evidence or a current
interaction service. Retrieved title/year/type/PMID links remain in the response;
private source IDs are attached to the durable decision. No raw patient query is
sent to the literature service, and no private model web search is enabled.

OpenAI uses `store:false`; this does not promise zero retention. See PRIVACY.md.
Configuration and mocked tests do not establish clinical accuracy or live model
availability. Validate representative synthetic cases with the chosen account
and model before relying on the new reasoning path.

## Release acceptance

Run the synthetic retrieval and response checks without a production database:

```sh
pnpm exec vitest run tests/server/health-observation-context.test.ts tests/server/contextual-advisor.test.ts tests/server/contextual-feedback.test.ts
```

- The same lab/focus/sleep request changes with relevant context and carries valid
  dated sources; missing or historical data is stated explicitly.
- A known direct follow-up answer advances the question without copying an old
  symptom or inventing a meal/medication event. A newer receipt blocks stale linkage.
- Terminal safety and interaction blocks prevent all external model/research calls.
- Summary citations retain exact contributors; provider failures produce useful
  labeled local feedback and content-free diagnostic categories.
- Separately verify the actual deployed context latency, owner-authenticated UI
  response and chosen provider. Passing synthetic tests or setting a key does not
  establish live model availability or clinical accuracy.

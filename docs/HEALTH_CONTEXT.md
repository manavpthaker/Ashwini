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

Every check-in now loads source-backed history, recent uncorrected non-protected
check-ins, actual active routines and latest imported observations per device,
source, metric and unit. A single latest observation is not a trend; overlapping
device streams are not summed. The canonical history is retained in full while
the model receives a bounded selected subset (up to 60 historical assertions,
12 recent check-ins and 40 latest measurement streams).

The rules remain the default and recognized terminal safety routes run before
research or model calls. Rules-only replies can surface relevant historical
context but do not pretend to perform model synthesis. Optional OpenAI reasoning
requires all three server-only variables:

- `OPENAI_API_KEY`
- `ASHWINI_MODEL` (a Responses API model supporting structured outputs)
- `ASHWINI_MODEL_CONTEXT_CONSENT=openai-v1` (only after owner opt-in)

The model returns one coordinated next step, up to three provisional hypotheses
with alternatives, uncertainty, one optional question and supplied source IDs.
Unknown IDs/malformed or failed responses fall back to rules with an explicit
status. Clinical routes are not labeled lifestyle hypotheses. The model never
receives permission to write prescriptions, schedules or measurements.

Europe PMC retrieval currently supports six broad topics: sleep, nutrition,
training, focus, caffeine and fatigue. Queries prioritize review literature with
no date/country cutoff. This is deliberately not described as universal research
coverage, a systematic review, independently appraised evidence or a current
interaction service. Retrieved title/year/type/PMID links remain in the response;
private source IDs are attached to the durable decision. No raw patient query is
sent to the literature service, and no private model web search is enabled.

OpenAI uses `store:false`; this does not promise zero retention. See PRIVACY.md.
Configuration and mocked tests do not establish clinical accuracy or live model
availability. Validate representative synthetic cases with the chosen account
and model before relying on the new reasoning path.

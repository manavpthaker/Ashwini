# Apple Health import

This is a private file import, not a live HealthKit connection. Wearable XML and
structured clinical FHIR JSON have separate importers. Validation alone does not
mean a file has been loaded into the canonical record; confirm the apply receipt
and database readback before claiming a live import.

On iPhone: **Health → Summary → profile → Export All Health Data**. Save/AirDrop
the export to a private folder on this Mac, outside the Git checkout, and extract
`export.xml` there. Do not commit the ZIP, XML, screenshots, or clinical records.
[Apple export instructions](https://support.apple.com/guide/iphone/share-your-health-data-iph5ede58c3d/ios).

## Validate, then apply

```sh
pnpm exec tsx scripts/import-apple-health.ts /absolute/private/path/export.xml
pnpm exec tsx scripts/import-apple-health.ts /absolute/private/path/export.xml --apply
```

The first command is a dry-run with **no database writes**. It reports counts,
type identifiers, date range, excluded element categories and file fingerprint;
it does not print measurement values, device names or source app names. Counts
are parsed samples, not necessarily unique samples. The apply report additionally
distinguishes unique, repeated and newly inserted samples.

Apply requires the existing `DATABASE_URL` and, for remote PostgreSQL,
`ASHWINI_POSTGRES_CA` in the process environment, plus migration
`20260906001700_health_observations.sql`. Do not paste credentials into a command
or put exports in this repository. The script does not load `.env` automatically.
It stages the whole export inside one transaction. Invalid XML, validation errors
or database failures roll everything back. Exact repeated exports are no-ops.

## Supported and deliberately excluded

- `Record`: type, original value/unit, source app/version/device, original
  timezone-bearing start/end dates, canonical instants and creation time.
- `Workout`: activity type and duration/unit with the same provenance. Separate
  workout statistics, energy and distance attributes are not imported by this
  first parser. They must not be assumed to be included in workout duration.
- Excluded **from the XML importer**: routes/coordinates, linked files,
  demographics (`Me`), clinical records, correlations, activity summaries,
  free text, third-party metadata,
  workout events and nested statistics. Excluded element counts are explicit;
  the corresponding contents are never persisted.

Only direct children of `HealthData` are imported. UTF-8 XML is parsed strictly
and incrementally with backpressure. Limits are 1 GiB, five million observations,
20 million elements, depth 32, and approximately 1 MiB for an unfinished XML token.
Bare and inert internal Apple doctypes are accepted; external declarations,
custom entities and processing instructions are refused. ZIPs are not opened by
the importer, preventing archive traversal and route extraction.

Each observation has an identity derived from its sample fields, independent of
export path/fingerprint. Identical samples across exports are deduplicated;
distinct sources/devices remain distinct. Each export has a separate fingerprint
and a batch-to-observation provenance link. Without a stable source sample UUID,
two truly distinct samples with identical supported fields cannot be separated.
This is an explicit limitation, not a clinical assertion.

Imported history is not current medication use, adherence, a diagnosis or a
clinician-confirmed fact. Missing data is unavailable, not zero or normal.
`summarizeHealthObservations` returns latest values per type/unit/source/device,
without combining overlapping devices or adding sleep stages together. Its
counts describe only supplied rows, not full-history coverage. Apple Health has
its own source-priority handling; raw sample sums need not equal the Health UI.
[Apple data-source behavior](https://support.apple.com/en-us/108779).

## Structured clinical records

Apple's export can also contain `clinical-records/*.json`. The XML importer does
not follow those links. Extract only the intended JSON files into an owner-private
directory, then validate separately:

```sh
pnpm health:apple-clinical /absolute/private/clinical-records
pnpm health:apple-clinical /absolute/private/clinical-records --prepare /absolute/private/new-curated-directory
pnpm health:apple-clinical /absolute/private/clinical-records --apply
```

Dry-run reports counts and dates only. `--prepare` creates a new directory with
mode 0700 and curated JSON files with mode 0600; these can be reviewed privately
and imported through Health context. Existing output directories are refused.
Neither dry-run nor preparation connects to a database. `--apply` uses the same
server-only database configuration and verified TLS as the XML importer.

The bounded adapter supports observations (including components), condition
history, medication requests, vaccinations, allergy history and procedures.
It retains supplied values, units, reference ranges, interpretation labels,
source statuses and source-date precision. Missing units stay missing. It does
not calculate new clinical flags or interpret results. An order is not evidence
that medication was taken; a problem-list status is not confirmation that a
condition remains current. These distinctions follow the source resource types:
[FHIR Observation](https://hl7.org/fhir/R4/observation.html),
[MedicationRequest](https://hl7.org/fhir/R4/medicationrequest.html) and
[Condition](https://hl7.org/fhir/R4/condition.html).

Resource identities are hashed into stable source keys; exact source bytes are
fingerprinted. Import source versions retain provenance and earlier versions.
When a verified provider namespace or resource ID is missing, identity falls
back to the content fingerprint. Exact repeated bytes still deduplicate, but
changed versions cannot automatically supersede an earlier record. The report
counts these limitations; an unscoped FHIR ID is not treated as globally unique.
The adapter accepts a verified `providerKey`; the directory CLI does not infer
one from filenames or patient identity. Withdrawn/error observation versions
contain no usable measurement assertions, and unsupported modifier extensions
are rejected because they could change the record's meaning.
All input is validated before writing. Payloads use the existing health-context
schema, with at most 100 source versions per batch and 2,000 assertions overall.
**Each apply batch is atomic, not the entire multi-batch clinical import.** An
interruption retains completed batches; retrying identical input is idempotent.

Narrative `text`, `note`, document attachments/URLs, patient identity fields,
raw CDA documents, ECG waveforms and route coordinates are not imported. Short
structured code labels, lab-result strings and reference-range text are allowed;
they remain untrusted source data. Diagnostic-report narratives and grouping
resources are excluded; their separately exported observations can be retained.
Unsupported resource categories are counted, not silently interpreted.

## Live sync and model access

Live sync requires an entitled native HealthKit app and per-type user permission;
the Vercel app cannot directly query an iPhone HealthKit store. Denied read access
is intentionally indistinguishable from unavailable data.
[HealthKit authorization](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data).

An import is not permission to send the entire raw export to research or model
providers. Any future external processing must clearly disclose the selected
health data and its purpose and obtain express permission. No external research
or model request occurs in this importer.
[HealthKit privacy](https://developer.apple.com/documentation/healthkit/protecting-user-privacy).

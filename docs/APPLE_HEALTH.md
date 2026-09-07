# Apple Health import

This is a private XML import, not a live HealthKit connection. No real Apple
Health export has been imported or validated yet.

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
- Excluded: routes/coordinates, linked files, demographics (`Me`), clinical
  records, correlations, activity summaries, free text, third-party metadata,
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

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Client } from "pg";
import {
  AppleHealthImportError,
  parseAppleHealthXml,
  type AppleHealthObservation,
} from "../lib/apple-health";
import { postgresConnectionConfig } from "../lib/postgres-connection";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const paths = args.filter((arg) => !arg.startsWith("--"));
  if (paths.length !== 1 || args.some((arg) => arg.startsWith("--") && arg !== "--apply")) {
    throw new AppleHealthImportError(
      "Usage: tsx scripts/import-apple-health.ts /private/path/export.xml [--apply]. Dry-run is the default.",
    );
  }
  const path = paths[0]!;
  const info = await stat(path);
  if (!info.isFile() || info.size > 1024 * 1024 * 1024) {
    throw new AppleHealthImportError(
      "Expected a regular XML file no larger than 1 GiB. ZIP files must be extracted privately first.",
    );
  }
  if (!apply) {
    const report = await parseAppleHealthXml(createReadStream(path), async () => {});
    process.stdout.write(
      `${JSON.stringify({ mode: "dry-run", ...report, persisted: false }, null, 2)}\n`,
    );
    return;
  }
  if (!process.env.DATABASE_URL)
    throw new AppleHealthImportError("DATABASE_URL is required for --apply.");
  const client = new Client(
    postgresConnectionConfig(process.env.DATABASE_URL, process.env.ASHWINI_POSTGRES_CA),
  );
  await client.connect();
  try {
    await client.query("begin");
    await client.query("set local statement_timeout = '120s'");
    await client.query("set local idle_in_transaction_session_timeout = '120s'");
    // Prevent competing import batches from producing misleading inserted counts.
    await client.query("select pg_advisory_xact_lock(1634953320, 17001)");
    await client.query(`create temporary table staged_health_observations
      (like ashwini.health_observations including defaults) on commit drop`);
    await client.query("alter table staged_health_observations drop column first_import_id");
    await client.query("create unique index on staged_health_observations(identity)");
    let stagedCount = 0;
    const report = await parseAppleHealthXml(createReadStream(path), async (observations) => {
      for (let start = 0; start < observations.length; start += 250) {
        const items = observations.slice(start, start + 250).map(toDatabaseRow);
        const result = await client.query(
          `insert into staged_health_observations
          select * from jsonb_populate_recordset(null::staged_health_observations, $1::jsonb)
          on conflict (identity) do nothing`,
          [JSON.stringify(items)],
        );
        stagedCount += result.rowCount ?? 0;
      }
    });
    const imported = await client.query<{ import_id: string }>(
      `insert into ashwini.health_import_batches(format, fingerprint, report)
       values ('apple-health-xml-v1', $1, $2::jsonb)
       on conflict (fingerprint) do nothing returning import_id`,
      [report.fingerprint, JSON.stringify(report)],
    );
    const importId = imported.rows[0]?.import_id;
    if (!importId) {
      await client.query("rollback");
      process.stdout.write(
        `${JSON.stringify({ mode: "apply", alreadyImported: true, ...report, inserted: 0 }, null, 2)}\n`,
      );
      return;
    }
    const inserted = await client.query(
      `insert into ashwini.health_observations
      (identity, first_import_id, kind, type, value, unit, source_name, source_version,
       device, start_at, end_at, original_start_at, original_end_at, source_created_at)
      select identity, $1::uuid, kind, type, value, unit, source_name, source_version,
       device, start_at, end_at, original_start_at, original_end_at, source_created_at
      from staged_health_observations on conflict (identity) do nothing`,
      [importId],
    );
    await client.query(
      `insert into ashwini.health_observation_imports(import_id, observation_identity)
      select $1::uuid, identity from staged_health_observations`,
      [importId],
    );
    await client.query("commit");
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: "apply",
          ...report,
          inserted: inserted.rowCount,
          uniqueInExport: stagedCount,
          duplicateSamplesInExport: report.records + report.workouts - stagedCount,
          previouslyImportedSamples: stagedCount - (inserted.rowCount ?? 0),
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

function toDatabaseRow(item: AppleHealthObservation) {
  return {
    identity: item.identity,
    kind: item.kind,
    type: item.type,
    value: item.value,
    unit: item.unit,
    source_name: item.sourceName,
    source_version: item.sourceVersion,
    device: item.device,
    start_at: item.startAt,
    end_at: item.endAt,
    original_start_at: item.originalStartAt,
    original_end_at: item.originalEndAt,
    source_created_at: item.createdAt,
  };
}

main().catch((error: unknown) => {
  // XML/DB errors may echo personal values. Only our deliberately safe errors
  // are printed. Never print SQL parameters, file contents or credentials.
  const message =
    error instanceof AppleHealthImportError
      ? error.message
      : "Apple Health import failed. Check file access, database migrations, credentials and verified TLS. No partial import was committed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

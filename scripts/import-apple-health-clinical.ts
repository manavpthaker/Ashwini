/** Local structured FHIR curation. No clinical values or credentials in logs. */
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  buildAppleHealthClinicalImports,
  type AppleHealthClinicalDocument,
} from "../lib/apple-health-clinical";
import { applyHealthContextImport } from "../lib/health-context-import";
import { postgresConnectionConfig } from "../lib/postgres-connection";

/** Validate every resource before preparing files or beginning any database write. */
export async function runAppleHealthClinicalImport(args: readonly string[]): Promise<void> {
  const directory = args[0];
  const apply = args[1] === "--apply";
  const prepareDirectory = args[1] === "--prepare" ? args[2] : undefined;
  if (
    !directory ||
    !isAbsolute(directory) ||
    !(
      args.length === 1 ||
      (apply && args.length === 2) ||
      (prepareDirectory && isAbsolute(prepareDirectory) && args.length === 3)
    )
  ) {
    throw new Error(
      "Usage: tsx scripts/import-apple-health-clinical.ts /absolute/clinical-records [--apply | --prepare /absolute/new-private-directory]",
    );
  }
  const directoryInfo = await lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new Error("Expected a real local clinical-records directory, not a symlink.");
  }
  const members = await readdir(directory, { withFileTypes: true });
  if (members.length > 5000) throw new Error("Too many clinical files.");
  const documents: AppleHealthClinicalDocument[] = [];
  let bytes = 0;
  for (const member of members.sort((left, right) => left.name.localeCompare(right.name))) {
    // No recursive reads, archive paths, hidden files, attachments or URL fetching.
    if (!/^[A-Za-z][A-Za-z0-9]*-[A-Za-z0-9.-]+\.json$/.test(member.name)) continue;
    const path = join(directory, member.name);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) {
      throw new Error("Expected bounded regular FHIR JSON files, not symlinks.");
    }
    bytes += info.size;
    if (bytes > 16 * 1024 * 1024) throw new Error("Clinical input exceeds 16 MiB.");
    documents.push({ raw: await readFile(path) });
  }
  if (!documents.length) throw new Error("No clinical FHIR files found.");
  const result = buildAppleHealthClinicalImports(documents);
  const counts = { sourcesInserted: 0, sourcesUnchanged: 0, entriesInserted: 0 };
  let completedBatches = 0;
  if (prepareDirectory) {
    // A new owner-private directory only. Never overwrite an earlier curation.
    await mkdir(prepareDirectory, { mode: 0o700 });
    for (const [index, payload] of result.imports.entries()) {
      await writeFile(
        join(prepareDirectory, `clinical-context-${String(index + 1).padStart(3, "0")}.json`),
        `${JSON.stringify(payload, null, 2)}\n`,
        { mode: 0o600, flag: "wx" },
      );
    }
    await writeFile(
      join(prepareDirectory, "report.json"),
      `${JSON.stringify({ ...result.report, persisted: false }, null, 2)}\n`,
      { mode: 0o600, flag: "wx" },
    );
  } else if (apply && result.imports.length) {
    const connection = process.env.DATABASE_URL;
    if (!connection || connection === "[SENSITIVE]") {
      throw new Error("DATABASE_URL is required for --apply.");
    }
    const client = new Client(
      postgresConnectionConfig(connection, process.env.ASHWINI_POSTGRES_CA),
    );
    try {
      await client.connect();
      // Each existing context payload is one atomic, idempotent transaction.
      // If interrupted, completed batches remain; an identical retry resumes safely.
      for (const payload of result.imports) {
        const imported = await applyHealthContextImport(client, payload);
        counts.sourcesInserted += imported.sourcesInserted;
        counts.sourcesUnchanged += imported.sourcesUnchanged;
        counts.entriesInserted += imported.entriesInserted;
        completedBatches += 1;
      }
    } catch {
      process.stderr.write(
        `Clinical import incomplete: ${completedBatches} batches confirmed committed. An identical retry is safe. No clinical values were logged.\n`,
      );
      throw new Error("Clinical import could not be confirmed.");
    } finally {
      await client.end();
    }
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: apply ? "apply" : prepareDirectory ? "prepare" : "dry-run",
        ...result.report,
        batches: result.imports.length,
        persisted: apply && result.imports.length > 0,
        ...(apply ? { completedBatches, ...counts } : {}),
      },
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAppleHealthClinicalImport(process.argv.slice(2)).catch(() => {
    process.stderr.write(
      "Clinical import could not be confirmed. Check input, output directory, schema and database configuration. Completed apply batches are retained; identical retries are idempotent. No raw error or clinical values were logged.\n",
    );
    process.exitCode = 1;
  });
}

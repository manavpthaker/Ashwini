/** Private JSON only; dry-run unless --apply. No statement or credential logging. */
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { parseHealthContextImport } from "../lib/health-context";
import { applyHealthContextImport } from "../lib/health-context-import";
import { postgresConnectionConfig } from "../lib/postgres-connection";

export async function runHealthContextImport(args: readonly string[]): Promise<void> {
  const apply = args.includes("--apply");
  const paths = args.filter((argument) => !argument.startsWith("--"));
  if (
    paths.length !== 1 ||
    args.some((argument) => argument.startsWith("--") && argument !== "--apply")
  ) {
    throw new Error("Usage: tsx scripts/import-health-context.ts /absolute/private.json [--apply]");
  }
  const path = paths[0];
  if (!path) throw new Error("A private JSON path is required.");
  if (!isAbsolute(path)) throw new Error("Use an absolute path to the private JSON file.");
  if ((await stat(path)).size > 5_000_000) throw new Error("Import exceeds the 5 MB limit.");
  const payload = parseHealthContextImport(JSON.parse(await readFile(path, "utf8")));
  const entries = payload.sources.reduce((count, source) => count + source.entries.length, 0);
  if (!apply) {
    process.stdout.write(
      `Validated dry-run: ${payload.sources.length} source versions, ${entries} curated assertions. No database connection or writes. Add --apply to import.\n`,
    );
    return;
  }
  const connection = process.env.DATABASE_URL;
  if (!connection) throw new Error("DATABASE_URL is required for --apply.");
  const client = new Client(postgresConnectionConfig(connection, process.env.ASHWINI_POSTGRES_CA));
  try {
    await client.connect();
    const result = await applyHealthContextImport(client, payload);
    process.stdout.write(
      `Imported ${result.sourcesInserted} source versions and ${result.entriesInserted} assertions; ${result.sourcesUnchanged} source versions unchanged.\n`,
    );
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runHealthContextImport(process.argv.slice(2)).catch(() => {
    // Driver errors may include SQL parameters, statement contents or hosts.
    process.stderr.write(
      "Health-context import could not be confirmed. Check the private file schema, database configuration, migration and source-version consistency; identical retries are idempotent.\n",
    );
    process.exitCode = 1;
  });
}

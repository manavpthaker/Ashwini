/**
 * Apply SQL migrations to the database named by DATABASE_URL.
 *
 * The canonical path to Supabase is `supabase db push`, which reads the same
 * `supabase/migrations` directory. This runner exists for the two places the
 * CLI is not available or not wanted: CI, which applies them to a throwaway
 * Postgres container, and a local Postgres for integration tests.
 *
 * Each file runs inside a transaction and is recorded with a checksum, so an
 * already-applied migration edited after the fact fails loudly instead of
 * silently diverging from what the database actually contains.
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { postgresConnectionConfig } from "../lib/postgres-connection";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to apply migrations.");
  }

  const files = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith(".sql")).sort();
  if (files.length === 0) {
    throw new Error(`No migrations found in ${MIGRATIONS_DIR}`);
  }

  const client = new Client(postgresConnectionConfig(connectionString));
  await client.connect();

  try {
    await client.query(`
      create schema if not exists ashwini;
      create table if not exists ashwini.schema_migrations (
        version text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      );
    `);

    const { rows } = await client.query<{ version: string; checksum: string }>(
      "select version, checksum from ashwini.schema_migrations",
    );
    const applied = new Map(rows.map((row) => [row.version, row.checksum]));

    let count = 0;
    for (const file of files) {
      const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const previous = applied.get(file);

      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new Error(
            `${file} has changed since it was applied. Migrations are immutable — add a new one instead.`,
          );
        }
        continue;
      }

      process.stdout.write(`applying ${file}\n`);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(
          "insert into ashwini.schema_migrations (version, checksum) values ($1, $2)",
          [file, checksum],
        );
        await client.query("commit");
        count += 1;
      } catch (error) {
        await client.query("rollback");
        throw new Error(`${file} failed: ${(error as Error).message}`, { cause: error });
      }
    }

    process.stdout.write(count === 0 ? "already up to date\n" : `applied ${count} migration(s)\n`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});

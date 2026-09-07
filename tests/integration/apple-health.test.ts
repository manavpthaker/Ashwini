/** Runs only on the explicitly configured, throwaway loopback Postgres in CI. */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const connectionString = process.env.ASHWINI_TEST_DATABASE_URL;
const describeIfDb = connectionString ? describe : describe.skip;
const execute = promisify(execFile);

describeIfDb("atomic private Apple Health import", () => {
  let client: Client;
  let directory: string;
  const source = `Synthetic importer ${crypto.randomUUID()}`;
  const record = (sourceName = source) =>
    `<Record type="HKQuantityTypeIdentifierStepCount" sourceName="${sourceName}" unit="count" startDate="2026-08-20 10:00:00 -0400" endDate="2026-08-20 10:05:00 -0400" value="321"/>`;

  beforeAll(async () => {
    const host = new URL(connectionString!).hostname;
    if (!/^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/.test(host)) {
      throw new Error("Apple Health integration tests require a throwaway loopback database.");
    }
    client = new Client({ connectionString });
    await client.connect();
    directory = await mkdtemp(join(tmpdir(), "ashwini-apple-health-test-"));
  });

  afterAll(async () => {
    await client?.end();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  async function run(name: string, xml: string, apply = false) {
    const path = join(directory, name);
    await writeFile(path, xml, { mode: 0o600 });
    const { stdout, stderr } = await execute(
      process.execPath,
      ["--import", "tsx", "scripts/import-apple-health.ts", path, ...(apply ? ["--apply"] : [])],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: connectionString },
        timeout: 20_000,
      },
    );
    expect(stderr).toBe("");
    return JSON.parse(stdout) as Record<string, unknown>;
  }

  async function observationCount(sourceName: string) {
    const result = await client.query<{ count: string }>(
      "select count(*)::text as count from ashwini.health_observations where source_name = $1",
      [sourceName],
    );
    return Number(result.rows[0]?.count);
  }

  it("dry-runs without writes, atomically imports, and deduplicates within/across exports", async () => {
    const xml = `<HealthData>${record()}${record()}</HealthData>`;
    const dry = await run("dry.xml", xml);
    expect(dry).toMatchObject({ mode: "dry-run", records: 2, persisted: false });
    expect(await observationCount(source)).toBe(0);

    const applied = await run("apply.xml", xml, true);
    expect(applied).toMatchObject({
      mode: "apply",
      records: 2,
      inserted: 1,
      uniqueInExport: 1,
      duplicateSamplesInExport: 1,
      previouslyImportedSamples: 0,
    });
    expect(await observationCount(source)).toBe(1);

    const exactReplay = await run("renamed.xml", xml, true);
    expect(exactReplay).toMatchObject({ alreadyImported: true, inserted: 0 });

    const overlap = await run(
      "overlap.xml",
      `<HealthData><ExportDate value="2026-09-01 00:00:00 +0000"/>${record()}</HealthData>`,
      true,
    );
    expect(overlap).toMatchObject({ inserted: 0, uniqueInExport: 1, previouslyImportedSamples: 1 });
    expect(await observationCount(source)).toBe(1);
    const stored = await client.query<{ original_start_at: string; start_at: Date; links: string }>(
      `select h.original_start_at, h.start_at, count(i.import_id)::text as links
       from ashwini.health_observations h join ashwini.health_observation_imports i
       on h.identity = i.observation_identity where h.source_name = $1
       group by h.identity`,
      [source],
    );
    expect(stored.rows[0]?.original_start_at).toBe("2026-08-20 10:00:00 -0400");
    expect(stored.rows[0]?.start_at.toISOString()).toBe("2026-08-20T14:00:00.000Z");
    expect(stored.rows[0]?.links).toBe("2");
  }, 30_000);

  it("rolls back earlier staged records when later XML is malformed", async () => {
    const sourceName = `Synthetic rollback ${crypto.randomUUID()}`;
    // Larger than a read chunk: the valid record reaches staging before the error.
    const xml = `<HealthData>${record(sourceName)}${" ".repeat(70_000)}</Wrong>`;
    await expect(run("malformed.xml", xml, true)).rejects.toThrow("Malformed XML");
    expect(await observationCount(sourceName)).toBe(0);
  });

  it("preserves records append-only and keeps all import tables RLS-denied", async () => {
    const sourceName = `Synthetic permissions ${crypto.randomUUID()}`;
    await run("permissions.xml", `<HealthData>${record(sourceName)}</HealthData>`, true);
    await expect(
      client.query("update ashwini.health_observations set value = '999' where source_name = $1", [
        sourceName,
      ]),
    ).rejects.toThrow("append-only");
    await expect(
      client.query("delete from ashwini.health_observations where source_name = $1", [sourceName]),
    ).rejects.toThrow("append-only");
    const security = await client.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'ashwini' and c.relname = any($1::text[]) order by c.relname`,
      [["health_import_batches", "health_observation_imports", "health_observations"]],
    );
    expect(security.rows).toHaveLength(3);
    expect(security.rows.every((row) => row.relrowsecurity && !row.relforcerowsecurity)).toBe(true);
    const policies = await client.query<{ count: string }>(
      "select count(*)::text as count from pg_policies where schemaname = 'ashwini' and tablename like 'health_%'",
    );
    expect(policies.rows[0]?.count).toBe("0");
  });
});

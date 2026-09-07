/** Server/CLI persistence shared by the authenticated import route and CLI. */
import { createHash } from "node:crypto";
import type { Client } from "pg";
import {
  parseHealthContextImport,
  type HealthContextImport,
  type HealthContextSourceImport,
} from "./health-context";

export function healthContextPayloadHash(source: HealthContextSourceImport): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        ...source,
        entries: [...source.entries].sort((left, right) => left.key.localeCompare(right.key)),
      }),
    )
    .digest("hex");
}

export interface HealthContextImportResult {
  sourcesInserted: number;
  sourcesUnchanged: number;
  entriesInserted: number;
}

/** Client must be connected, dedicated to this call, and outside a transaction. */
export async function applyHealthContextImport(
  client: Client,
  input: HealthContextImport,
): Promise<HealthContextImportResult> {
  const payload = parseHealthContextImport(input);
  const result = { sourcesInserted: 0, sourcesUnchanged: 0, entriesInserted: 0 };
  await client.query("begin");
  try {
    // One import lock serializes source versions so an older concurrent write
    // cannot win the current-context pointer merely through commit timing.
    await client.query("select pg_advisory_xact_lock(hashtext('ashwini.health-context-import'))");
    for (const source of payload.sources) {
      const payloadHash = healthContextPayloadHash(source);
      const inserted = await client.query<{ source_id: string }>(
        `insert into ashwini.health_context_sources
          (source_key, source_label, source_locator, content_hash, payload_hash, source_date, date_precision, curation_revision)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (source_key, content_hash, curation_revision) do nothing returning source_id`,
        [
          source.key,
          source.label,
          source.locator,
          source.contentHash,
          payloadHash,
          source.sourceDate,
          source.datePrecision,
          source.revision,
        ],
      );
      const sourceId = inserted.rows[0]?.source_id;
      if (!sourceId) {
        const prior = await client.query<{ payload_hash: string }>(
          "select payload_hash from ashwini.health_context_sources where source_key = $1 and content_hash = $2 and curation_revision = $3",
          [source.key, source.contentHash, source.revision],
        );
        if (prior.rows[0]?.payload_hash !== payloadHash) {
          throw new Error(
            "A source version already exists with different curated assertions. Create a newly versioned source instead of rewriting history.",
          );
        }
        result.sourcesUnchanged += 1;
        continue;
      }
      result.sourcesInserted += 1;
      for (const entry of source.entries) {
        await client.query(
          `insert into ashwini.health_context_entries
            (source_id, entry_key, category, statement, source_locator, source_date,
             date_precision, temporal_status, confirmation_required)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            sourceId,
            entry.key,
            entry.category,
            entry.statement,
            entry.sourceLocator,
            entry.sourceDate,
            entry.datePrecision,
            entry.temporalStatus,
            entry.confirmationRequired,
          ],
        );
        result.entriesInserted += 1;
      }
    }
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

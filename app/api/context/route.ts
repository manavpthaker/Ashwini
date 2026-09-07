import { Client } from "pg";
import { systemClock } from "@/domain/clock";
import { healthContextImportSchema } from "@/lib/health-context";
import { applyHealthContextImport } from "@/lib/health-context-import";
import { postgresConnectionConfig } from "@/lib/postgres-connection";
import { currentPrincipal } from "@/server/auth";
import { buildSubjectContext } from "@/server/context";
import { env } from "@/server/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_IMPORT_BYTES = 1024 * 1024;
const noStore = { "cache-control": "no-store" };

function advisorMode() {
  const contextConsent = process.env.ASHWINI_MODEL_CONTEXT_CONSENT === "openai-v1";
  const model = process.env.ASHWINI_MODEL?.trim() || null;
  const configured = Boolean(process.env.OPENAI_API_KEY?.trim() && model && contextConsent);
  return {
    configured,
    provider: configured ? "openai" : "rules",
    model: configured ? model : null,
    contextConsent,
  };
}

export async function GET(request: Request): Promise<Response> {
  if (!(await currentPrincipal(request))) return problem(401, "Not signed in.");
  try {
    // The shell needs readiness only, not a second copy of private history.
    if (new URL(request.url).searchParams.get("mode") === "1") {
      return Response.json({ mode: advisorMode() }, { headers: noStore });
    }
    const clock = systemClock(env().ASHWINI_TIME_ZONE);
    const context = await buildSubjectContext(clock);
    return Response.json(
      { history: context.healthHistory ?? [], mode: advisorMode(), generatedAt: clock.now().toISOString() },
      { headers: noStore },
    );
  } catch {
    return problem(503, "Your health context is temporarily unavailable.");
  }
}

class ImportTooLarge extends Error {}

/** Enforce the limit while reading; Content-Length is not trusted. */
async function readImportBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > MAX_IMPORT_BYTES) throw new ImportTooLarge();
  if (!request.body) throw new Error("Missing body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_IMPORT_BYTES) {
        await reader.cancel();
        throw new ImportTooLarge();
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
}

export async function POST(request: Request): Promise<Response> {
  if (!(await currentPrincipal(request))) return problem(401, "Not signed in.");
  const origin = request.headers.get("origin");
  if (
    (origin !== null && origin !== new URL(request.url).origin) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    return problem(403, "Import health context from this app's signed-in page.");
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return problem(415, "Choose a curated health-context JSON file.");
  }

  let body: unknown;
  try {
    body = await readImportBody(request);
  } catch (error) {
    return error instanceof ImportTooLarge
      ? problem(413, "The import must be no larger than 1 MB.")
      : problem(400, "The import is not valid JSON.");
  }
  const parsed = healthContextImportSchema.safeParse(body);
  if (!parsed.success) {
    return problem(400, "This file does not match the curated health-context format. Check dates, source keys, confirmation flags and the therapy-narrative exclusion.");
  }

  let client: Client | undefined;
  try {
    const settings = env();
    if (!settings.DATABASE_URL) return problem(503, "Health-context storage is not configured.");
    client = new Client({
      ...postgresConnectionConfig(settings.DATABASE_URL, settings.ASHWINI_POSTGRES_CA),
      connectionTimeoutMillis: 10_000,
      statement_timeout: 15_000,
    });
    await client.connect();
    const result = await applyHealthContextImport(client, parsed.data);
    return Response.json(result, {
      status: result.sourcesInserted > 0 ? 201 : 200,
      headers: noStore,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("A source version already exists")) {
      return problem(409, "That source version already exists with different details. Increment its curation revision to preserve both versions.");
    }
    // Never log raw import bodies, source statements, or database error details.
    return problem(503, "The import could not be confirmed. Retrying the same file is safe.");
  } finally {
    await client?.end().catch(() => undefined);
  }
}

function problem(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: noStore });
}

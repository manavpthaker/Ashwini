import { sql } from "kysely";
import { db } from "@/server/db/client";

/**
 * Liveness and readiness.
 *
 * Reports whether the process can actually reach the database, because "the
 * page loads" and "your records are reachable" are different questions and a
 * health app should not blur them.
 */
export async function GET(): Promise<Response> {
  const startedAt = Date.now();

  try {
    await sql`select 1`.execute(db());
    return Response.json(
      { status: "ok", database: "reachable", latencyMs: Date.now() - startedAt },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        status: "degraded",
        database: "unreachable",
        // The message can name a host; it never carries a credential, because
        // env.ts is the only thing that reads DATABASE_URL.
        detail: error instanceof Error ? error.message : "unknown error",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

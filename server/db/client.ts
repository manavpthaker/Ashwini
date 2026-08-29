import "server-only";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { env } from "../env";
import type { Database } from "./types";

/**
 * The one Postgres connection for the process.
 *
 * Connect through Supavisor **session mode** (port 5432 on the Supabase pooler
 * host). Two reasons, both practical:
 *
 *   - Supabase direct connections are IPv6-only unless the IPv4 add-on is on,
 *     and a home Mac mini may not have working IPv6.
 *   - Port 6543 is transaction mode, meant for serverless. This is a long-lived
 *     Node process, so session mode is the right shape.
 *
 * The pool is small on purpose: one user, one app, and a pooler in front of it.
 */

let instance: Kysely<Database> | null = null;

export function db(): Kysely<Database> {
  if (instance) return instance;

  const { DATABASE_URL } = env();
  if (!DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. The app cannot read or write health records without it.",
    );
  }

  instance = new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: DATABASE_URL,
        max: 5,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
        // Supabase terminates TLS with a public CA; the default verification is
        // correct here. Do not disable it to silence a certificate error.
      }),
    }),
  });

  return instance;
}

/** Close the pool. For tests and for a clean shutdown, not for request handling. */
export async function closeDb(): Promise<void> {
  if (!instance) return;
  await instance.destroy();
  instance = null;
}

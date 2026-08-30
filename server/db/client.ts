import "server-only";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { postgresConnectionConfig } from "@/lib/postgres-connection";
import { env } from "../env";
import type { Database } from "./types";

/**
 * The one Postgres connection for the process.
 *
 * Which Supavisor port to use depends on where this runs, and getting it wrong
 * is the classic Supabase failure mode:
 *
 * - **Serverless (Vercel):** transaction mode, **port 6543**. Each invocation is
 *   potentially a fresh process, so an application-level pool is destroyed on
 *   exit and pooling has to happen upstream. Keep `max` at 1 — many concurrent
 *   instances each holding several connections is how you exhaust the pool.
 * - **A long-lived process (the Mac mini):** session mode, **port 5432**, with a
 *   small local pool. Also the IPv4-compatible option, which matters because
 *   Supabase direct connections are IPv6-only without the add-on.
 *
 * Transaction mode does not support named prepared statements. node-postgres
 * only creates those when a query is given a `name`, and Kysely does not, so
 * this combination is safe as written — but a future raw query that names a
 * statement would break on 6543 only, and never locally.
 */

let instance: Kysely<Database> | null = null;

function isServerless(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

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
        ...postgresConnectionConfig(DATABASE_URL),
        // One connection per serverless instance; a small pool on a real process.
        max: isServerless() ? 1 : 5,
        idleTimeoutMillis: isServerless() ? 10_000 : 30_000,
        connectionTimeoutMillis: 10_000,
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

/**
 * Build a node-postgres connection config without letting URL query parameters
 * weaken the explicit TLS policy.
 *
 * `pg` parses `connectionString` after the surrounding config object. An
 * `sslmode`, `ssl`, certificate, or key parameter in that string can therefore
 * replace an explicit `ssl` object unless it is removed first.
 */

const TLS_QUERY_PARAMETERS = new Set(["ssl", "sslcert", "sslkey", "sslmode", "sslrootcert"]);

const INSECURE_SSL_MODES = new Set(["allow", "disable", "no-verify", "prefer"]);
const SUPPORTED_SSL_MODES = new Set(["require", "verify-ca", "verify-full"]);
const INSECURE_SSL_VALUES = new Set([
  "0",
  "allow",
  "disable",
  "false",
  "no-verify",
  "off",
  "prefer",
]);

export interface PostgresConnectionConfig {
  connectionString: string;
  ssl: false | { rejectUnauthorized: true };
}

function parsePostgresUrl(connectionString: string): URL {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid postgres:// or postgresql:// URL.");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres:// or postgresql:// protocol.");
  }

  return url;
}

function valuesFor(url: URL, parameter: string): string[] {
  return [...url.searchParams.entries()]
    .filter(([name]) => name.toLowerCase() === parameter)
    .map(([, value]) => value.trim().toLowerCase());
}

function rejectInsecureTlsOptions(url: URL): void {
  for (const mode of valuesFor(url, "sslmode")) {
    if (INSECURE_SSL_MODES.has(mode)) {
      throw new Error(
        `DATABASE_URL sslmode=${mode} is refused. Remote PostgreSQL connections require certificate and hostname verification.`,
      );
    }
    if (!SUPPORTED_SSL_MODES.has(mode)) {
      throw new Error(`DATABASE_URL contains unsupported sslmode=${mode || "(empty)"}.`);
    }
  }

  for (const value of valuesFor(url, "ssl")) {
    if (INSECURE_SSL_VALUES.has(value)) {
      throw new Error("DATABASE_URL may not disable PostgreSQL TLS or certificate verification.");
    }
  }
}

function removeTlsQueryOptions(url: URL): void {
  for (const name of [...url.searchParams.keys()]) {
    if (TLS_QUERY_PARAMETERS.has(name.toLowerCase())) {
      url.searchParams.delete(name);
    }
  }
}

function effectiveHostname(url: URL): string {
  // node-postgres lets a `host` query parameter override the URL hostname.
  // Resolve the same effective target before choosing the TLS policy.
  const queryHosts = url.searchParams.getAll("host");
  const host = queryHosts.at(-1) ?? url.hostname;
  return host
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  );
}

/**
 * Local development and CI databases use plaintext loopback connections.
 * Every other host gets public-CA and hostname verification.
 */
export function postgresConnectionConfig(connectionString: string): PostgresConnectionConfig {
  const url = parsePostgresUrl(connectionString);
  rejectInsecureTlsOptions(url);

  const hostname = effectiveHostname(url);
  if (!hostname) {
    throw new Error(
      "DATABASE_URL must name an explicit host so the PostgreSQL TLS policy cannot depend on ambient environment variables.",
    );
  }

  const local = isLoopbackHost(hostname);
  removeTlsQueryOptions(url);

  return {
    connectionString: url.toString(),
    ssl: local ? false : { rejectUnauthorized: true },
  };
}

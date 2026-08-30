import { describe, expect, it } from "vitest";
import { Client } from "pg";
import { postgresConnectionConfig } from "@/lib/postgres-connection";

describe("PostgreSQL connection transport", () => {
  it.each([
    "postgres://user:password@localhost:5432/ashwini",
    "postgres://user:password@localhost.:5432/ashwini",
    "postgres://user:password@database.localhost:5432/ashwini",
    "postgres://user:password@127.0.0.1:5432/ashwini",
    "postgres://user:password@[::1]:5432/ashwini",
  ])("keeps the loopback development database non-TLS: %s", (connectionString) => {
    expect(postgresConnectionConfig(connectionString).ssl).toBe(false);
  });

  it("enforces certificate and hostname verification for a remote host", () => {
    expect(
      postgresConnectionConfig(
        "postgres://user:password@db.hlykstavsipzjjmwlyou.supabase.co:5432/postgres",
      ).ssl,
    ).toEqual({ rejectUnauthorized: true });
  });

  it.each(["require", "verify-ca", "verify-full"])(
    "upgrades sslmode=%s to the same explicit verified TLS policy",
    (mode) => {
      const config = postgresConnectionConfig(
        `postgres://user:password@remote.example.test:5432/postgres?sslmode=${mode}`,
      );

      expect(config.ssl).toEqual({ rejectUnauthorized: true });
      expect(new URL(config.connectionString).searchParams.get("sslmode")).toBeNull();
    },
  );

  it("uses the query host because node-postgres lets it override the URL hostname", () => {
    expect(
      postgresConnectionConfig(
        "postgres://user:password@localhost:5432/postgres?host=remote.example.test",
      ).ssl,
    ).toEqual({ rejectUnauthorized: true });
  });

  it("removes every node-postgres TLS override while preserving unrelated options", () => {
    const config = postgresConnectionConfig(
      "postgres://user:password@remote.example.test:5432/postgres?sslmode=verify-full&ssl=true&sslcert=%2Ftmp%2Fclient.crt&sslkey=%2Ftmp%2Fclient.key&sslrootcert=%2Ftmp%2Froot.crt&application_name=ashwini",
    );
    const sanitized = new URL(config.connectionString);

    expect(sanitized.searchParams.get("sslmode")).toBeNull();
    expect(sanitized.searchParams.get("ssl")).toBeNull();
    expect(sanitized.searchParams.get("sslcert")).toBeNull();
    expect(sanitized.searchParams.get("sslkey")).toBeNull();
    expect(sanitized.searchParams.get("sslrootcert")).toBeNull();
    expect(sanitized.searchParams.get("application_name")).toBe("ashwini");

    // This construction would read the certificate paths and replace the
    // explicit SSL object if any of the stripped options still reached pg.
    const client = new Client(config);
    expect((client as unknown as { ssl: unknown }).ssl).toEqual({ rejectUnauthorized: true });
  });

  it.each(["disable", "allow", "prefer", "no-verify"])("refuses insecure sslmode=%s", (mode) => {
    expect(() =>
      postgresConnectionConfig(
        `postgres://user:password@remote.example.test:5432/postgres?sslmode=${mode}`,
      ),
    ).toThrow(/refused/);
  });

  it.each(["0", "false", "off", "no-verify"])("refuses insecure ssl=%s", (value) => {
    expect(() =>
      postgresConnectionConfig(
        `postgres://user:password@remote.example.test:5432/postgres?ssl=${value}`,
      ),
    ).toThrow(/may not disable/);
  });

  it("rejects an unknown sslmode instead of silently accepting a typo", () => {
    expect(() =>
      postgresConnectionConfig(
        "postgres://user:password@remote.example.test:5432/postgres?sslmode=verify",
      ),
    ).toThrow(/unsupported sslmode/);
  });

  it("rejects a URL with no host rather than inheriting PGHOST", () => {
    expect(() => postgresConnectionConfig("postgres:///ashwini")).toThrow(/explicit host/);
  });

  it("does not put the rejected URL or its password into a parse error", () => {
    const secret = "do-not-print-this";
    expect(() => postgresConnectionConfig(`not-a-url-${secret}`)).toThrow(
      "DATABASE_URL must be a valid postgres:// or postgresql:// URL.",
    );

    try {
      postgresConnectionConfig(`not-a-url-${secret}`);
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });
});

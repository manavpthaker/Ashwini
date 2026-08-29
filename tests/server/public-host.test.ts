import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { proxy } from "@/proxy";
import { env, resetEnvCache } from "@/server/env";

/**
 * The app must refuse to run where the internet can reach it.
 *
 * `proxy.ts` authorises on a request header. That is sound only because
 * `tailscale serve` sets the header itself and nothing else can reach the port.
 * On a public host the header is attacker-controlled, so the gate would look
 * like security while admitting anyone who types the owner's address.
 */

const HOSTS = ["VERCEL", "AWS_LAMBDA_FUNCTION_NAME", "NETLIFY"] as const;

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/health", { headers });
}

const saved: Record<string, string | undefined> = {};

/** Next types process.env.NODE_ENV as readonly; tests need to vary it. */
function setEnv(key: string, value: string | undefined): void {
  const bag = process.env as Record<string, string | undefined>;
  if (value === undefined) delete bag[key];
  else bag[key] = value;
}

beforeEach(() => {
  for (const key of [
    ...HOSTS,
    "NODE_ENV",
    "ASHWINI_TAILSCALE_USER",
    "ASHWINI_REQUIRE_IDENTITY",
    "DATABASE_URL",
  ]) {
    saved[key] = process.env[key];
    setEnv(key, undefined);
  }
  resetEnvCache();
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    setEnv(key, value);
  }
  resetEnvCache();
});

describe("proxy on a public host", () => {
  for (const host of HOSTS) {
    it(`refuses every request when ${host} is set`, async () => {
      setEnv(host, "1");
      process.env.ASHWINI_TAILSCALE_USER = "owner@example.com";

      // Even a request presenting the correct identity is refused: on a public
      // host that header proves nothing, because the caller supplied it.
      const response = proxy(request({ "tailscale-user-login": "owner@example.com" }) as never);
      expect(response.status).toBe(403);
      const body = (await response.json()) as { error: string };
      expect(body.error).toMatch(/refuses to serve/);
      expect(body.error).toMatch(/forge/);
    });
  }

  it("serves normally on a private host with a matching identity", () => {
    process.env.ASHWINI_TAILSCALE_USER = "owner@example.com";
    const response = proxy(request({ "tailscale-user-login": "owner@example.com" }) as never);
    expect(response.status).toBe(200);
  });

  it("still rejects a mismatched identity on a private host", async () => {
    process.env.ASHWINI_TAILSCALE_USER = "owner@example.com";
    const response = proxy(request({ "tailscale-user-login": "someone@else.com" }) as never);
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/not permitted/);
  });

  it("rejects a request with no identity at all", () => {
    process.env.ASHWINI_TAILSCALE_USER = "owner@example.com";
    expect(proxy(request() as never).status).toBe(403);
  });

  it("refuses when no identity is configured to match against", () => {
    expect(proxy(request({ "tailscale-user-login": "anyone@example.com" }) as never).status).toBe(
      403,
    );
  });

  it("allows an ungated request outside production, for local development", () => {
    process.env.ASHWINI_REQUIRE_IDENTITY = "0";
    expect(proxy(request() as never).status).toBe(200);
  });

  it("refuses an ungated request in production even on a private host", () => {
    process.env.ASHWINI_REQUIRE_IDENTITY = "0";
    setEnv("NODE_ENV", "production");
    expect(proxy(request() as never).status).toBe(403);
  });
});

describe("env on a public host", () => {
  for (const host of HOSTS) {
    it(`refuses to boot in production when ${host} is set`, () => {
      setEnv(host, "1");
      setEnv("NODE_ENV", "production");
      process.env.DATABASE_URL = "postgres://user:pw@example.test:5432/db";
      process.env.ASHWINI_TAILSCALE_USER = "owner@example.com";

      expect(() => env()).toThrow(/Refusing to start on/);
    });
  }

  it("boots on a private host with the required settings", () => {
    setEnv("NODE_ENV", "production");
    process.env.DATABASE_URL = "postgres://user:pw@example.test:5432/db";
    process.env.ASHWINI_TAILSCALE_USER = "owner@example.com";
    expect(() => env()).not.toThrow();
  });

  it("refuses production without a database", () => {
    setEnv("NODE_ENV", "production");
    process.env.ASHWINI_TAILSCALE_USER = "owner@example.com";
    expect(() => env()).toThrow(/DATABASE_URL is required/);
  });

  it("refuses production with the identity gate turned off", () => {
    setEnv("NODE_ENV", "production");
    process.env.DATABASE_URL = "postgres://user:pw@example.test:5432/db";
    process.env.ASHWINI_TAILSCALE_USER = "owner@example.com";
    process.env.ASHWINI_REQUIRE_IDENTITY = "0";
    expect(() => env()).toThrow(/refused in production/);
  });

  it("refuses production with no identity to match against", () => {
    setEnv("NODE_ENV", "production");
    process.env.DATABASE_URL = "postgres://user:pw@example.test:5432/db";
    expect(() => env()).toThrow(/ASHWINI_TAILSCALE_USER is required/);
  });
});

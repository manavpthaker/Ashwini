import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The request gate.
 *
 * @supabase/ssr is mocked so the session-verification path can be exercised
 * without a network call — this is the security-critical branch and it should
 * not go untested just because it talks to a service.
 */

const getUser = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser } }),
}));

const { proxy } = await import("@/proxy");
const { env, resetEnvCache } = await import("@/server/env");

const MANAGED_KEYS = [
  "VERCEL",
  "AWS_LAMBDA_FUNCTION_NAME",
  "NETLIFY",
  "NODE_ENV",
  "DATABASE_URL",
  "ASHWINI_TAILSCALE_USER",
  "ASHWINI_REQUIRE_IDENTITY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "ASHWINI_ALLOWED_EMAILS",
] as const;

const saved: Record<string, string | undefined> = {};

/** Next types process.env.NODE_ENV as readonly; tests need to vary it. */
function setEnv(key: string, value: string | undefined): void {
  const bag = process.env as Record<string, string | undefined>;
  if (value === undefined) delete bag[key];
  else bag[key] = value;
}

function useSupabaseAuth(): void {
  setEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  setEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  setEnv("ASHWINI_ALLOWED_EMAILS", "owner@example.com");
}

function request(path = "/api/decisions", headers: Record<string, string> = {}) {
  return {
    headers: new Headers(headers),
    cookies: { getAll: () => [], set: () => {} },
    nextUrl: {
      pathname: path,
      clone: () => new URL(`https://example.test${path}`),
    },
  } as never;
}

beforeEach(() => {
  for (const key of MANAGED_KEYS) {
    saved[key] = process.env[key];
    setEnv(key, undefined);
  }
  getUser.mockReset();
  resetEnvCache();
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) setEnv(key, value);
  resetEnvCache();
});

describe("a public host", () => {
  for (const host of ["VERCEL", "AWS_LAMBDA_FUNCTION_NAME", "NETLIFY"]) {
    it(`refuses the Tailscale gate on ${host}`, async () => {
      setEnv(host, "1");
      setEnv("ASHWINI_TAILSCALE_USER", "owner@example.com");

      // Even presenting the correct identity: on a public host the caller
      // supplied that header, so it proves nothing.
      const response = await proxy(
        request("/api/decisions", { "tailscale-user-login": "owner@example.com" }),
      );
      expect(response.status).toBe(403);
      const body = (await response.json()) as { error: string };
      expect(body.error).toMatch(/without real authentication/);
      expect(body.error).toMatch(/forge/);
    });
  }

  it("permits a verified Supabase session on Vercel", async () => {
    setEnv("VERCEL", "1");
    useSupabaseAuth();
    getUser.mockResolvedValue({
      data: { user: { id: "u1", email: "owner@example.com" } },
      error: null,
    });

    const response = await proxy(request());
    expect(response.status).toBe(200);
    expect(getUser).toHaveBeenCalled();
  });
});

describe("the Supabase gate", () => {
  beforeEach(useSupabaseAuth);

  it("admits the permitted account", async () => {
    getUser.mockResolvedValue({
      data: { user: { id: "u1", email: "owner@example.com" } },
      error: null,
    });
    expect((await proxy(request())).status).toBe(200);
  });

  it("returns 401 for an API call with no session", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await proxy(request("/api/decisions"));
    expect(response.status).toBe(401);
  });

  it("redirects a page request with no session to the login page", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await proxy(request("/plan"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toMatch(/\/login/);
  });

  it("refuses a valid account that is not on the allowlist", async () => {
    // A real Supabase user from the same project is still not this record's owner.
    getUser.mockResolvedValue({
      data: { user: { id: "u2", email: "someone@else.com" } },
      error: null,
    });
    const response = await proxy(request());
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/not permitted/);
  });

  it("treats a verification error as unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "jwt expired" } });
    expect((await proxy(request())).status).toBe(401);
  });

  it("lets the login flow and health check through without a session", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    for (const path of ["/login", "/api/auth/sign-in", "/api/auth/callback", "/api/health"]) {
      expect((await proxy(request(path))).status).toBe(200);
    }
    // None of those should have cost a verification round trip.
    expect(getUser).not.toHaveBeenCalled();
  });
});

describe("the Tailscale gate on a private host", () => {
  beforeEach(() => setEnv("ASHWINI_TAILSCALE_USER", "owner@example.com"));

  it("admits a matching identity", async () => {
    const response = await proxy(
      request("/api/decisions", { "tailscale-user-login": "owner@example.com" }),
    );
    expect(response.status).toBe(200);
  });

  it("rejects a mismatched identity", async () => {
    const response = await proxy(
      request("/api/decisions", { "tailscale-user-login": "someone@else.com" }),
    );
    expect(response.status).toBe(403);
  });

  it("rejects a request with no identity header", async () => {
    expect((await proxy(request())).status).toBe(403);
  });
});

describe("nothing configured", () => {
  it("is allowed through in development", async () => {
    expect((await proxy(request())).status).toBe(200);
  });

  it("is refused in production", async () => {
    setEnv("NODE_ENV", "production");
    const response = await proxy(request());
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/No authentication is configured/);
  });
});

describe("env at boot", () => {
  it("refuses production with no auth configured", () => {
    setEnv("NODE_ENV", "production");
    setEnv("DATABASE_URL", "postgres://user:pw@example.test:5432/db");
    expect(() => env()).toThrow(/No authentication is configured/);
  });

  it("refuses production on Vercel with only the Tailscale gate", () => {
    setEnv("NODE_ENV", "production");
    setEnv("VERCEL", "1");
    setEnv("DATABASE_URL", "postgres://user:pw@example.test:5432/db");
    setEnv("ASHWINI_TAILSCALE_USER", "owner@example.com");
    expect(() => env()).toThrow(/Refusing to start on Vercel/);
  });

  it("boots on Vercel with Supabase auth", () => {
    setEnv("NODE_ENV", "production");
    setEnv("VERCEL", "1");
    setEnv("DATABASE_URL", "postgres://user:pw@example.test:6543/db");
    useSupabaseAuth();
    expect(() => env()).not.toThrow();
  });

  it("boots on a private host with the Tailscale gate", () => {
    setEnv("NODE_ENV", "production");
    setEnv("DATABASE_URL", "postgres://user:pw@example.test:5432/db");
    setEnv("ASHWINI_TAILSCALE_USER", "owner@example.com");
    expect(() => env()).not.toThrow();
  });

  it("refuses production without a database", () => {
    setEnv("NODE_ENV", "production");
    setEnv("ASHWINI_TAILSCALE_USER", "owner@example.com");
    expect(() => env()).toThrow(/DATABASE_URL is required/);
  });

  it("refuses production with the Tailscale gate turned off", () => {
    setEnv("NODE_ENV", "production");
    setEnv("DATABASE_URL", "postgres://user:pw@example.test:5432/db");
    setEnv("ASHWINI_TAILSCALE_USER", "owner@example.com");
    setEnv("ASHWINI_REQUIRE_IDENTITY", "0");
    expect(() => env()).toThrow(/refused in production/);
  });
});

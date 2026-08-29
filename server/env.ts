import "server-only";
import { z } from "zod";
import { permittedOnPublicHost, publicHost, readAuthConfig } from "@/lib/auth/config";

/**
 * Environment, validated once at boot.
 *
 * Two rules this file exists to enforce:
 *
 * 1. Nothing here is NEXT_PUBLIC_. Every value below is a server secret or a
 *    server-side setting, and NEXT_PUBLIC_ inlines values into the browser
 *    bundle. CI greps for a NEXT_PUBLIC_ variable whose name looks like a
 *    credential and fails the build.
 * 2. It fails at startup rather than at the first request. A health app that
 *    boots with a missing DATABASE_URL and 500s on the first record is worse
 *    than one that refuses to start.
 */

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /**
   * Supabase Postgres.
   *
   * Use the Supavisor **session mode** connection string (port 5432). Supabase
   * direct connections are IPv6-only unless the IPv4 add-on is enabled, and a
   * home Mac mini may not have working IPv6. Port 6543 is transaction mode and
   * is meant for serverless, not a long-lived Node process.
   */
  DATABASE_URL: z.string().url().optional(),

  /**
   * The zone all server-side day boundaries are resolved in.
   *
   * This is a product setting, not a formatting detail: it decides which day a
   * meal or a dose belongs to, and which time-of-day brief the user opens into.
   */
  ASHWINI_TIME_ZONE: z.string().min(1).default("UTC"),

  /** Server credential for the Examine Connect safety endpoint. Never client-side. */
  EXAMINE_CONNECT_API_KEY: z.string().min(1).optional(),

  /**
   * The tailnet login permitted to reach this instance.
   *
   * "No public ingress" is not the same as "no auth": every node on the tailnet
   * can reach port 443 on this machine. `tailscale serve` injects
   * Tailscale-User-Login on proxied requests and proxy.ts checks it against this.
   */
  ASHWINI_TAILSCALE_USER: z.string().min(1).optional(),

  /** Set to "0" to run without the identity gate. Refused in production. */
  ASHWINI_REQUIRE_IDENTITY: z
    .enum(["0", "1"])
    .optional()
    .transform((value) => value !== "0"),

  /** Seeding synthetic fixtures is opt-in and never allowed in production. */
  ASHWINI_ALLOW_SEED: z
    .enum(["0", "1"])
    .default("0")
    .transform((value) => value === "1"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${detail}`);
  }

  const value = parsed.data;

  if (value.NODE_ENV === "production") {
    if (!value.DATABASE_URL) {
      throw new Error("DATABASE_URL is required in production.");
    }

    const auth = readAuthConfig();

    if (auth.mode === "none") {
      throw new Error(
        "No authentication is configured. Set Supabase auth (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, ASHWINI_ALLOWED_EMAILS), or ASHWINI_TAILSCALE_USER behind `tailscale serve`.",
      );
    }

    // proxy.ts refuses per request; this refuses at boot, so the process never
    // comes up holding a live DATABASE_URL somewhere its gate cannot hold.
    const host = publicHost();
    if (host && !permittedOnPublicHost(auth)) {
      throw new Error(
        `Refusing to start on ${host} with only the Tailscale identity gate. That gate trusts a request header \`tailscale serve\` injects; on a public host any caller can forge it. Configure Supabase auth. See docs/PRIVACY.md.`,
      );
    }

    if (auth.mode === "tailscale" && value.ASHWINI_REQUIRE_IDENTITY === false) {
      throw new Error(
        "ASHWINI_REQUIRE_IDENTITY=0 is refused in production. The identity gate is the only thing standing between the tailnet and the health record.",
      );
    }
  }

  cached = value;
  return cached;
}

/** Test seam: forget the cached parse so a test can vary process.env. */
export function resetEnvCache(): void {
  cached = null;
}

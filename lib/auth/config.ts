/**
 * Auth configuration, readable from both the proxy runtime and the server.
 *
 * Deliberately free of `server-only` and of any import from `server/env.ts`:
 * proxy.ts runs separately from render code and the Next docs warn against
 * relying on shared server modules there.
 *
 * ## Why two modes
 *
 * `tailscale` authorises on a request header that `tailscale serve` injects.
 * That is sound only where nothing else can reach the port — on a public host
 * the same header is supplied by the caller and proves nothing.
 *
 * `supabase` verifies a real session, so it holds anywhere, which is what makes
 * a public deployment defensible.
 *
 * The mode is derived rather than configured: if Supabase auth is set up, it is
 * used. One rule, no flag to get wrong.
 */

/** Just a bag of strings — no need to demand the full ProcessEnv shape. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

export type AuthMode = "supabase" | "tailscale" | "none";

export interface AuthConfig {
  readonly mode: AuthMode;
  readonly supabaseUrl: string | null;
  /**
   * The anon key is designed to be public — it identifies the project and
   * carries no privileges of its own; row-level security is what protects data.
   * It is the one NEXT_PUBLIC_*_KEY this repo permits, and CI allows it by name.
   */
  readonly supabaseAnonKey: string | null;
  /** Addresses permitted to hold a session. Normally exactly one. */
  readonly allowedEmails: readonly string[];
  readonly tailscaleUser: string | null;
}

export function readAuthConfig(source: EnvSource = process.env): AuthConfig {
  const supabaseUrl = source.NEXT_PUBLIC_SUPABASE_URL?.trim() || null;
  const supabaseAnonKey = source.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || null;
  const allowedEmails = (source.ASHWINI_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const tailscaleUser = source.ASHWINI_TAILSCALE_USER?.trim() || null;

  const supabaseReady = Boolean(supabaseUrl && supabaseAnonKey && allowedEmails.length > 0);

  return {
    mode: supabaseReady ? "supabase" : tailscaleUser ? "tailscale" : "none",
    supabaseUrl,
    supabaseAnonKey,
    allowedEmails,
    tailscaleUser,
  };
}

/** Hosts that serve traffic from the public internet. */
export function publicHost(source: EnvSource = process.env): string | null {
  if (source.VERCEL) return "Vercel";
  if (source.AWS_LAMBDA_FUNCTION_NAME) return "AWS Lambda";
  if (source.NETLIFY) return "Netlify";
  return null;
}

/**
 * Whether this configuration may serve from a public host.
 *
 * Only Supabase auth qualifies. The Tailscale header mode is refused there, and
 * there is no override flag: running publicly on a forgeable header is not a
 * configuration choice, it is a vulnerability with a switch in front of it.
 */
export function permittedOnPublicHost(config: AuthConfig): boolean {
  return config.mode === "supabase";
}

export function isAllowedEmail(config: AuthConfig, email: string | null | undefined): boolean {
  if (!email) return false;
  return config.allowedEmails.includes(email.trim().toLowerCase());
}

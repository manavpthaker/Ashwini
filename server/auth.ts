import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isAllowedEmail, publicHost, readAuthConfig } from "@/lib/auth/config";

/**
 * Who is making this request, for route handlers and server components.
 *
 * proxy.ts has already refused anything unauthenticated, so this is normally a
 * convenience rather than a second gate. It is still a real check: defence in
 * depth costs one round trip, and a route reachable some other way (a matcher
 * change, a future rewrite) should not become open by accident.
 */

export interface Session {
  readonly userId: string;
  readonly email: string;
}

const IDENTITY_HEADER = "tailscale-user-login";

export async function currentSession(): Promise<Session | null> {
  const config = readAuthConfig();

  if (config.mode !== "supabase") {
    // Under the Tailscale gate there is no session object; proxy.ts is the
    // authority and the caller is the single owner by construction.
    return null;
  }

  const cookieStore = await cookies();

  const supabase = createServerClient(
    config.supabaseUrl as string,
    config.supabasePublishableKey as string,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        // Route handlers can set cookies, but token refresh is proxy.ts's job.
        // Writing them here too would race it.
        setAll: () => {},
      },
    },
  );

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  if (!isAllowedEmail(config, data.user.email)) return null;

  return { userId: data.user.id, email: data.user.email as string };
}

/** Throws rather than returning null, for handlers that cannot proceed without one. */
export async function requireSession(): Promise<Session> {
  const session = await currentSession();
  if (!session) throw new Error("Not signed in.");
  return session;
}

/**
 * Verify the single owner inside a record-bearing route.
 *
 * Proxy is the first gate. This is the second, route-local gate so a future
 * matcher or rewrite mistake cannot expose a health endpoint. It preserves the
 * supported private Tailscale deployment while refusing that header on a public
 * host, where a caller could forge it.
 */
export async function currentPrincipal(request: Request): Promise<Session | null> {
  const config = readAuthConfig();

  if (config.mode === "supabase") return currentSession();

  if (config.mode === "tailscale") {
    if (publicHost()) return null;
    const presented = request.headers.get(IDENTITY_HEADER)?.trim().toLowerCase();
    const expected = config.tailscaleUser?.trim().toLowerCase();
    if (!presented || !expected || presented !== expected) return null;
    return { userId: "single-owner", email: config.tailscaleUser as string };
  }

  if (process.env.NODE_ENV !== "production") {
    return { userId: "local-development", email: "local-development" };
  }

  return null;
}

export async function requirePrincipal(request: Request): Promise<Session> {
  const principal = await currentPrincipal(request);
  if (!principal) throw new Error("Not signed in.");
  return principal;
}

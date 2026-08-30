import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isAllowedEmail, readAuthConfig } from "@/lib/auth/config";

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

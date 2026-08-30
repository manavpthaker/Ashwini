import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { z } from "zod";
import { isAllowedEmail, readAuthConfig } from "@/lib/auth/config";

/**
 * Send a magic link.
 *
 * The allowlist is checked before Supabase is asked to send anything, so an
 * address that could never hold a session never receives mail either.
 *
 * The response is identical whether or not the address is allowed. That is not
 * politeness: this endpoint is reachable without a session, so a distinguishing
 * response would let anyone enumerate whose record this is.
 */

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email(),
  next: z.string().startsWith("/").max(200).optional(),
});

const ACCEPTED = {
  message: "If that address can sign in, a link is on its way.",
} as const;

export async function POST(request: Request): Promise<Response> {
  const config = readAuthConfig();

  if (config.mode !== "supabase") {
    return Response.json(
      { error: "Supabase auth is not configured on this deployment." },
      { status: 501, headers: { "cache-control": "no-store" } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Request body is not valid JSON." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "A valid email address is required." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  if (!isAllowedEmail(config, parsed.data.email)) {
    return Response.json(ACCEPTED, { status: 202, headers: { "cache-control": "no-store" } });
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    config.supabaseUrl as string,
    config.supabasePublishableKey as string,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        },
      },
    },
  );

  const origin = new URL(request.url).origin;
  const callback = new URL("/api/auth/callback", origin);
  if (parsed.data.next) callback.searchParams.set("next", parsed.data.next);

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      emailRedirectTo: callback.toString(),
      // Single-subject product: there is no sign-up flow, only the owner
      // signing in. Supabase must not create an account for an unknown address.
      shouldCreateUser: false,
    },
  });

  if (error) {
    return Response.json(
      { error: "Could not send the sign-in link." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }

  return Response.json(ACCEPTED, { status: 202, headers: { "cache-control": "no-store" } });
}

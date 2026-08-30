import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isAllowedEmail, readAuthConfig } from "@/lib/auth/config";
import { safeNextPath } from "@/lib/auth/safe-next";

/**
 * Where the magic link lands. Exchanges the code for a session and sets cookies.
 *
 * The allowlist is checked again here rather than trusted from sign-in: a code
 * could in principle be issued by another route or another client of the same
 * Supabase project, and this is the point where a session actually starts.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const target = safeNextPath(url.searchParams.get("next")) ?? "/";

  const config = readAuthConfig();
  if (config.mode !== "supabase") {
    return redirectToLogin(url, "unavailable");
  }

  if (!code) {
    return redirectToLogin(url, "missing-code");
  }

  const cookieStore = await cookies();
  const response = NextResponse.redirect(new URL(target, url.origin));

  const supabase = createServerClient(
    config.supabaseUrl as string,
    config.supabasePublishableKey as string,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return redirectToLogin(url, "exchange-failed");
  }

  if (!isAllowedEmail(config, data.user.email)) {
    await supabase.auth.signOut();
    return redirectToLogin(url, "not-permitted");
  }

  return response;
}

/**
 * Reasons are coarse on purpose. This endpoint is reachable without a session,
 * so the difference between "no such account" and "not permitted" is not
 * something to hand out.
 */
function redirectToLogin(url: URL, reason: string): Response {
  const login = new URL("/login", url.origin);
  login.searchParams.set("error", reason);
  return NextResponse.redirect(login);
}

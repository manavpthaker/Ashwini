import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  isAllowedEmail,
  permittedOnPublicHost,
  publicHost,
  readAuthConfig,
} from "@/lib/auth/config";

/**
 * The gate every request passes through.
 *
 * Two modes, chosen by what is configured (see lib/auth/config.ts):
 *
 * - **supabase** — verifies a real session. Holds on any host, which is what
 *   makes a public deployment defensible.
 * - **tailscale** — trusts the `Tailscale-User-Login` header that
 *   `tailscale serve` injects. Sound only where nothing else can reach the
 *   port, so it is refused on a public host.
 *
 * Deliberately reads process.env rather than importing server/env.ts: the Next
 * docs warn that proxy runs separately from render code and should not rely on
 * shared modules.
 */

const IDENTITY_HEADER = "tailscale-user-login";

/**
 * Reachable without a session: the login flow, liveness, and the scheduler.
 *
 * The scheduler has no session to present — it is a cron, not a person — so it
 * authenticates on a shared secret inside its own handler. That handler refuses
 * to run at all when the secret is unset, so passing it through here does not
 * leave it open.
 */
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/sign-in",
  "/api/auth/callback",
  "/api/health",
  "/api/reminders/run",
];

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const config = readAuthConfig();
  const host = publicHost();

  if (host && !permittedOnPublicHost(config)) {
    return deny(
      `Ashwini refuses to serve from ${host} without real authentication. The Tailscale identity header it would otherwise trust is set by \`tailscale serve\`; on a public host any caller can forge it. Configure Supabase auth (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, ASHWINI_ALLOWED_EMAILS) or run it on the private host.`,
    );
  }

  if (config.mode === "none") {
    if (process.env.NODE_ENV === "production") {
      return deny(
        "No authentication is configured. Set up Supabase auth, or ASHWINI_TAILSCALE_USER behind `tailscale serve`.",
      );
    }
    // Local development with nothing configured: let it through, but only here.
    return NextResponse.next();
  }

  if (config.mode === "supabase") {
    return supabaseGate(request, config);
  }

  return tailscaleGate(request, config);
}

async function supabaseGate(
  request: NextRequest,
  config: ReturnType<typeof readAuthConfig>,
): Promise<NextResponse> {
  if (isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    config.supabaseUrl as string,
    config.supabaseAnonKey as string,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          // Both halves matter: the request copy so this handler sees the refreshed
          // token, the response copy so the browser keeps it. Omitting either is the
          // documented cause of random logouts.
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser(), never getSession(): getSession only reads the cookie and does not
  // verify it, so it cannot decide whether to admit a request.
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return unauthenticated(request);
  }

  if (!isAllowedEmail(config, data.user.email)) {
    // A valid Supabase user from some other project or sign-up is still not this
    // record's owner. The allowlist is what makes this single-subject.
    return deny("This account is not permitted to reach this record.");
  }

  return response;
}

function tailscaleGate(
  request: NextRequest,
  config: ReturnType<typeof readAuthConfig>,
): NextResponse {
  const presented = request.headers.get(IDENTITY_HEADER);

  if (!presented) {
    return deny(
      "No Tailscale identity on this request. Reach this app through `tailscale serve`, not the port directly.",
    );
  }

  if (presented.toLowerCase() !== (config.tailscaleUser as string).toLowerCase()) {
    return deny("This tailnet identity is not permitted.");
  }

  return NextResponse.next();
}

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** An API caller wants a 401; a browser wants the login page. */
function unauthenticated(request: NextRequest): NextResponse {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return new NextResponse(JSON.stringify({ error: "Not signed in." }), {
      status: 401,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    }) as NextResponse;
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

function deny(reason: string): NextResponse {
  return new NextResponse(JSON.stringify({ error: reason }), {
    status: 403,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  }) as NextResponse;
}

export const config = {
  // Static assets carry no health data; everything else, including every API
  // route, passes through the gate.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * The identity gate.
 *
 * PRD 11.3 mandates no public ingress, and `tailscale serve` delivers that —
 * but "reachable only from the tailnet" is not the same as "reachable only by
 * me". Every node on a tailnet can reach port 443 on this machine, so a shared
 * tailnet (family, a work laptop, a contractor) would otherwise have the health
 * record one curl away.
 *
 * `tailscale serve` injects Tailscale-User-Login on proxied requests. This
 * checks it, and the tailnet ACL should independently restrict 443 on this node
 * to the owner. Bind Next to 127.0.0.1 as well, so nothing on the LAN can reach
 * the app directly and skip this check.
 *
 * Deliberately reads process.env rather than importing server/env.ts: the Next
 * docs warn that proxy runs separately from render code and should not rely on
 * shared modules.
 */

const IDENTITY_HEADER = "tailscale-user-login";

/**
 * Hosts that serve traffic from the public internet.
 *
 * The identity check below reads a request header. That is only sound because
 * `tailscale serve` sets the header itself and nothing else can reach the port.
 * On a public host the same header is attacker-controlled — anyone can send
 * `Tailscale-User-Login: <the owner>` and walk straight in — so the gate would
 * be decorative while looking like security.
 *
 * Refusing to serve is therefore the only safe behaviour, and there is no
 * override flag on purpose: running publicly is not a configuration choice,
 * it is a different architecture that needs real authentication first.
 */
function publicHost(): string | null {
  if (process.env.VERCEL) return "Vercel";
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return "AWS Lambda";
  if (process.env.NETLIFY) return "Netlify";
  return null;
}

export function proxy(request: NextRequest): NextResponse {
  const host = publicHost();
  if (host) {
    return deny(
      `Ashwini refuses to serve from ${host}. PRD 11.3 requires no public ingress, and the identity header this app trusts is set by \`tailscale serve\` — on a public host any caller can forge it. Run it on the private host, or replace the header check with real authentication first.`,
    );
  }

  const expected = process.env.ASHWINI_TAILSCALE_USER;
  const required = process.env.ASHWINI_REQUIRE_IDENTITY !== "0";

  if (!required) {
    if (process.env.NODE_ENV === "production") {
      // env.ts refuses to boot in this state; this is the second line of defence
      // in case the app is started some other way.
      return deny("The identity gate cannot be disabled in production.");
    }
    return NextResponse.next();
  }

  if (!expected) {
    return deny("ASHWINI_TAILSCALE_USER is not configured, so no request can be authorised.");
  }

  const presented = request.headers.get(IDENTITY_HEADER);
  if (!presented) {
    return deny(
      "No Tailscale identity on this request. Reach this app through `tailscale serve`, not the port directly.",
    );
  }

  if (presented.toLowerCase() !== expected.toLowerCase()) {
    return deny("This tailnet identity is not permitted.");
  }

  return NextResponse.next();
}

function deny(reason: string): NextResponse {
  return new NextResponse(JSON.stringify({ error: reason }), {
    status: 403,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  }) as NextResponse;
}

export const config = {
  // Static assets carry no health data and are requested before the identity
  // header is useful; everything else, including every API route, is gated.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

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

export function proxy(request: NextRequest): NextResponse {
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

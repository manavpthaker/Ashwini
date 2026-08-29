import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy.
 *
 * `unsafe-inline` for scripts is Next's inline bootstrap; tightening it needs a
 * nonce, which is worth doing once the front end settles.
 *
 * fonts.googleapis.com / fonts.gstatic.com are here because app/globals.css
 * still opens with an @import of three Google font families. Self-hosting them
 * via next/font/local would drop these two entries, remove a render-blocking
 * request, and stop a health app making third-party requests at all.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  /**
   * Was `output: "export"`, which forbids route handlers, headers() and any
   * server code — so lib/examine-connect.ts had nowhere to run and the API
   * surface could not exist.
   *
   * `standalone` emits a self-contained server, which is what a self-hosted box
   * wants. Vercel builds its own output and does not want it, so this is left
   * unset there — a stale project "Output Directory" plus an unexpected output
   * mode is the likeliest cause of a failed Vercel build.
   *
   * Note: standalone does NOT copy `public/` or `.next/static`. A self-hosted
   * start script has to, or the deployed app serves no CSS. See README.
   *
   * `trailingSlash: true` went with `output: "export"` — a static export writes
   * `check-in/index.html`, so the links had to carry the slash. Served by a real
   * server the slash is a liability: it makes `/api/conversation` a 308 to
   * `/api/conversation/` on every request, which is a redirect a POST has to
   * survive for no benefit. The links dropped their slashes instead.
   */
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
  reactStrictMode: true,
  turbopack: {
    // `import.meta.dirname`, not `__dirname`: package.json now declares
    // `"type": "module"`, so this file is evaluated as ESM and `__dirname`
    // does not exist there.
    root: import.meta.dirname,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            // Camera stays available: PRD 7.2 and 7.4 depend on meal and body capture.
            value: "geolocation=(), microphone=(), payment=(), usb=(), camera=(self)",
          },
        ],
      },
      {
        // Health records must never sit in a shared or browser cache.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, private" }],
      },
    ];
  },
};

export default nextConfig;

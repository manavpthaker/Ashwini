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
   * surface could not exist. `standalone` emits a self-contained server for the
   * Mac mini.
   *
   * Note: standalone does NOT copy `public/` or `.next/static`. The start
   * script has to, or the deployed app serves no CSS. See README.
   */
  output: "standalone",
  reactStrictMode: true,
  turbopack: {
    root: __dirname,
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

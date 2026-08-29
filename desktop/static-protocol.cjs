const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_ORIGIN = "app://ashwini";
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "media-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
].join("; ");

function isInsideRoot(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

async function resolveStaticPath(outRoot, pathname) {
  let decoded;

  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  if (decoded.includes("\0")) return null;

  const relative = decoded.replace(/^\/+/, "");
  const candidates = [];

  if (!relative) {
    candidates.push("index.html");
  } else if (decoded.endsWith("/")) {
    candidates.push(path.join(relative, "index.html"));
  } else if (path.extname(relative)) {
    candidates.push(relative);
  } else {
    candidates.push(relative, `${relative}.html`, path.join(relative, "index.html"));
  }

  for (const candidate of candidates) {
    const resolved = path.resolve(outRoot, candidate);
    if (!isInsideRoot(outRoot, resolved)) continue;

    try {
      const stat = await fs.stat(resolved);
      if (stat.isFile()) return resolved;
    } catch {
      // Try the next exact static-export representation.
    }
  }

  return null;
}

function createStaticProtocolHandler({ outRoot, net }) {
  const canonicalRoot = path.resolve(outRoot);

  return async function handleStaticRequest(request) {
    const url = new URL(request.url);
    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }

    if (url.protocol !== "app:" || url.hostname !== "ashwini" || url.port || url.username || url.password) {
      return new Response("Not found", { status: 404 });
    }

    const filePath = await resolveStaticPath(canonicalRoot, url.pathname);
    if (!filePath) return new Response("Not found", { status: 404 });

    const source = await net.fetch(pathToFileURL(filePath).toString());
    const headers = new Headers(source.headers);
    headers.set("Content-Security-Policy", PRODUCTION_CSP);
    headers.set("X-Content-Type-Options", "nosniff");

    return new Response(request.method === "HEAD" ? null : source.body, {
      status: source.status,
      statusText: source.statusText,
      headers,
    });
  };
}

module.exports = {
  APP_ORIGIN,
  PRODUCTION_CSP,
  createStaticProtocolHandler,
  resolveStaticPath,
};

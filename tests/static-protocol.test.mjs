import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import staticProtocol from "../desktop/static-protocol.cjs";

const { createStaticProtocolHandler, resolveStaticPath } = staticProtocol;

async function withExportFixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ashwini-static-"));

  try {
    await fs.mkdir(path.join(root, "check-in"), { recursive: true });
    await fs.mkdir(path.join(root, "_next", "static"), { recursive: true });
    await fs.writeFile(path.join(root, "index.html"), "today");
    await fs.writeFile(path.join(root, "check-in", "index.html"), "check-in");
    await fs.writeFile(path.join(root, "_next", "static", "app.js"), "asset");
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("maps exported root, nested route, and exact asset paths", async () => {
  await withExportFixture(async (root) => {
    assert.equal(await resolveStaticPath(root, "/"), path.join(root, "index.html"));
    assert.equal(await resolveStaticPath(root, "/check-in/"), path.join(root, "check-in", "index.html"));
    assert.equal(await resolveStaticPath(root, "/_next/static/app.js"), path.join(root, "_next", "static", "app.js"));
  });
});

test("does not resolve traversal, malformed encoding, or missing paths", async () => {
  await withExportFixture(async (root) => {
    assert.equal(await resolveStaticPath(root, "/../outside.txt"), null);
    assert.equal(await resolveStaticPath(root, "/%2e%2e/outside.txt"), null);
    assert.equal(await resolveStaticPath(root, "/%E0%A4%A"), null);
    assert.equal(await resolveStaticPath(root, "/missing/"), null);
  });
});

test("serves trusted app responses with security headers", async () => {
  await withExportFixture(async (root) => {
    const handler = createStaticProtocolHandler({
      outRoot: root,
      net: { fetch: async (url) => new Response(await fs.readFile(new URL(url)), { headers: { "Content-Type": "text/html" } }) },
    });
    const response = await handler(new Request("app://ashwini/"));

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "today");
    assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  });
});

test("rejects unsupported methods and untrusted app origins", async () => {
  await withExportFixture(async (root) => {
    const handler = createStaticProtocolHandler({
      outRoot: root,
      net: { fetch: async () => new Response("unused") },
    });

    assert.equal((await handler(new Request("app://ashwini/", { method: "POST" }))).status, 405);
    assert.equal((await handler(new Request("app://other/"))).status, 404);
    assert.equal((await handler({ method: "GET", url: "app://user@ashwini/" })).status, 404);
  });
});

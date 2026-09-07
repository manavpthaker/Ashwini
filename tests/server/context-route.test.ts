import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  principal: vi.fn(),
  context: vi.fn(),
  env: vi.fn(),
  apply: vi.fn(),
  connect: vi.fn(),
  end: vi.fn(),
  client: vi.fn(),
}));

vi.mock("@/server/auth", () => ({ currentPrincipal: mocks.principal }));
vi.mock("@/server/context", () => ({ buildHealthHistory: mocks.context }));
vi.mock("@/server/env", () => ({ env: mocks.env }));
vi.mock("@/lib/health-context-import", () => ({ applyHealthContextImport: mocks.apply }));
vi.mock("pg", () => ({
  Client: class {
    connect = mocks.connect;
    end = mocks.end;
    constructor(settings: unknown) {
      mocks.client(settings);
    }
  },
}));

import { GET, POST } from "@/app/api/context/route";

const fixture = {
  version: 1,
  containsTherapyNarrative: false,
  sources: [
    {
      key: "synthetic-context",
      label: "Synthetic preferences",
      locator: "synthetic/private.md",
      contentHash: "a".repeat(64),
      sourceDate: null,
      datePrecision: "unknown",
      entries: [
        {
          key: "short-sessions",
          category: "preference",
          statement: "Synthetic owner prefers short movement sessions.",
          sourceLocator: "Preferences, line 1",
          sourceDate: null,
          datePrecision: "unknown",
          temporalStatus: "uncertain",
          confirmationRequired: false,
        },
      ],
    },
  ],
};

function request(body: unknown = fixture, headers: Record<string, string> = {}) {
  return new Request("https://ashwini.test/api/context", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://ashwini.test", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.principal.mockResolvedValue({ userId: "test-owner", email: "owner@example.test" });
  mocks.context.mockResolvedValue([]);
  mocks.env.mockReturnValue({
    DATABASE_URL: "postgres://test:unused@127.0.0.1/test",
    ASHWINI_TIME_ZONE: "UTC",
  });
  mocks.apply.mockResolvedValue({ sourcesInserted: 1, sourcesUnchanged: 0, entriesInserted: 1 });
  mocks.connect.mockResolvedValue(undefined);
  mocks.end.mockResolvedValue(undefined);
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("ASHWINI_MODEL", "");
  vi.stubEnv("ASHWINI_MODEL_CONTEXT_CONSENT", "");
});

afterEach(() => vi.unstubAllEnvs());

describe("authenticated health-context API", () => {
  it("requires the owner on both methods before reading or writing context", async () => {
    mocks.principal.mockResolvedValue(null);
    expect((await GET(new Request("https://ashwini.test/api/context"))).status).toBe(401);
    expect((await POST(request())).status).toBe(401);
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("returns stored history without caching", async () => {
    mocks.context.mockResolvedValue([{ id: "synthetic-history" }]);
    const result = await GET(new Request("https://ashwini.test/api/context"));
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toMatchObject({
      history: [{ id: "synthetic-history" }],
      mode: { configured: false, provider: "rules", model: null },
    });
  });

  it("returns only mode metadata for the shell without fetching private history", async () => {
    vi.stubEnv("OPENAI_API_KEY", "synthetic-server-key");
    vi.stubEnv("ASHWINI_MODEL", "configured-model");
    let result = await GET(new Request("https://ashwini.test/api/context?mode=1"));
    expect(await result.json()).toEqual({
      mode: { configured: false, provider: "rules", model: null, contextConsent: false },
    });
    vi.stubEnv("ASHWINI_MODEL_CONTEXT_CONSENT", "openai-v1");
    result = await GET(new Request("https://ashwini.test/api/context?mode=1"));
    expect(await result.json()).toEqual({
      mode: {
        configured: true,
        provider: "openai",
        model: "configured-model",
        contextConsent: true,
      },
    });
    expect(mocks.context).not.toHaveBeenCalled();
  });

  it("rejects cross-origin and cross-site writes", async () => {
    expect((await POST(request(fixture, { origin: "https://other.test" }))).status).toBe(403);
    expect((await POST(request(fixture, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("bounds declared and streamed bodies before creating a database client", async () => {
    expect(
      (await POST(request(fixture, { "content-length": String(1024 * 1024 + 1) }))).status,
    ).toBe(413);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(512 * 1024));
        controller.enqueue(new Uint8Array(512 * 1024 + 1));
        controller.close();
      },
    });
    const streamed = new Request("https://ashwini.test/api/context", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "1" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect((await POST(streamed)).status).toBe(413);
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("returns safe validation errors, not imported statements", async () => {
    const result = await POST(
      request({ ...fixture, containsTherapyNarrative: true, secret: "SENSITIVE_INPUT_MARKER" }),
    );
    expect(result.status).toBe(400);
    expect(await result.text()).not.toContain("SENSITIVE_INPUT_MARKER");
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("rejects other content types and malformed JSON", async () => {
    expect((await POST(request(fixture, { "content-type": "text/plain" }))).status).toBe(415);
    const bad = new Request("https://ashwini.test/api/context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect((await POST(bad)).status).toBe(400);
  });

  it("uses a dedicated client, returns counts and closes it", async () => {
    const result = await POST(request());
    expect(result.status).toBe(201);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toEqual({
      sourcesInserted: 1,
      sourcesUnchanged: 0,
      entriesInserted: 1,
    });
    expect(mocks.apply.mock.calls[0]?.[1].sources[0].revision).toBe(1);
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(mocks.client).toHaveBeenCalledWith(
      expect.objectContaining({ ssl: false, connectionTimeoutMillis: 10_000 }),
    );
  });

  it("does not claim new records when the exact source version was already saved", async () => {
    mocks.apply.mockResolvedValue({ sourcesInserted: 0, sourcesUnchanged: 1, entriesInserted: 0 });
    expect((await POST(request())).status).toBe(200);
  });

  it("does not expose database errors or log health content", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.apply.mockRejectedValue(new Error("SENSITIVE_DATABASE_MARKER"));
    const result = await POST(request());
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain("SENSITIVE_DATABASE_MARKER");
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("reports source-version conflicts without rewriting history", async () => {
    mocks.apply.mockRejectedValue(
      new Error("A source version already exists with different curated assertions."),
    );
    expect((await POST(request())).status).toBe(409);
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it("renders unavailable rather than empty when context lookup fails", async () => {
    mocks.context.mockRejectedValue(new Error("SENSITIVE_QUERY_MARKER"));
    const result = await GET(new Request("https://ashwini.test/api/context"));
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain("SENSITIVE_QUERY_MARKER");
  });
});

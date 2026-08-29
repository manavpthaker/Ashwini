import { afterEach, describe, expect, it, vi } from "vitest";
import { ExamineConnectError, checkExamineInteractions } from "@/lib/examine-connect";

/**
 * The adapter had four latent defects that only mattered once it had a caller:
 * no timeout, no retry, an unguarded response.json(), and no server-only guard.
 * These cover the first three; the fourth is a build error, not a runtime one.
 */

const OK_BODY = {
  data: [],
  references: [],
  status: "ok",
  checked_names: ["creatine", "sertraline"],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const items = ["creatine", "sertraline"];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("input validation", () => {
  it("refuses fewer than two distinct items", async () => {
    await expect(checkExamineInteractions(["creatine"], { apiKey: "k" })).rejects.toThrow(
      /at least two distinct/,
    );
  });

  it("counts duplicates and blanks as one item", async () => {
    await expect(
      checkExamineInteractions(["creatine", " creatine ", ""], { apiKey: "k" }),
    ).rejects.toThrow(/at least two distinct/);
  });

  it("refuses more than 25 items", async () => {
    const many = Array.from({ length: 26 }, (_, index) => `item-${index}`);
    await expect(checkExamineInteractions(many, { apiKey: "k" })).rejects.toThrow(/at most 25/);
  });
});

describe("authorisation", () => {
  it("fails closed with no key, rather than returning an empty result", async () => {
    // PRD 7.3: silence is never evidence that no interaction exists, so an
    // unauthorised adapter must refuse rather than look like an all-clear.
    const previous = process.env.EXAMINE_CONNECT_API_KEY;
    delete process.env.EXAMINE_CONNECT_API_KEY;
    try {
      await expect(checkExamineInteractions(items)).rejects.toThrow(/not authorized/);
    } finally {
      if (previous !== undefined) process.env.EXAMINE_CONNECT_API_KEY = previous;
    }
  });

  it("does not retry an unauthorised call", async () => {
    const fetchImpl = vi.fn();
    const previous = process.env.EXAMINE_CONNECT_API_KEY;
    delete process.env.EXAMINE_CONNECT_API_KEY;
    try {
      await expect(checkExamineInteractions(items, { fetchImpl })).rejects.toThrow();
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      if (previous !== undefined) process.env.EXAMINE_CONNECT_API_KEY = previous;
    }
  });
});

describe("the request", () => {
  it("sends the deduplicated items with a bearer token and no caching", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(OK_BODY));
    await checkExamineInteractions(["creatine", "creatine", "sertraline"], {
      apiKey: "secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("safety-database/interactions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret");
    expect(init.cache).toBe("no-store");
    expect(JSON.parse(init.body as string)).toEqual({ items: ["creatine", "sertraline"] });
  });

  it("returns the parsed response on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(OK_BODY));
    const result = await checkExamineInteractions(items, {
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.checked_names).toEqual(["creatine", "sertraline"]);
  });
});

describe("failure handling", () => {
  it("retries once on a 503 and succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "unavailable" }, 503))
      .mockResolvedValueOnce(jsonResponse(OK_BODY));

    const result = await checkExamineInteractions(items, {
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("ok");
  });

  it("retries once on a 429", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse(OK_BODY));
    await checkExamineInteractions(items, {
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400 — repeating a bad request just spends the rate limit", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "bad" }, 400));
    await expect(
      checkExamineInteractions(items, {
        apiKey: "k",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 400/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gives up after the single retry", async () => {
    // Fresh Response per call: a body can only be read once.
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse({}, 502));
    await expect(
      checkExamineInteractions(items, {
        apiKey: "k",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(ExamineConnectError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("reports a non-JSON body as an ExamineConnectError, not a raw SyntaxError", async () => {
    // A proxy returning an HTML error page used to escape the error contract
    // every caller is written against.
    const html = new Response("<html>502 Bad Gateway</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    const fetchImpl = vi.fn().mockImplementation(async () => html.clone());
    await expect(
      checkExamineInteractions(items, {
        apiKey: "k",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/not JSON/);
  });

  it("rejects a response whose shape is wrong, and does not retry it", async () => {
    // A malformed body will be malformed again; retrying it is pointless.
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse({ data: "nope" }));
    await expect(
      checkExamineInteractions(items, {
        apiKey: "k",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/unexpected response shape/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("surfaces a timeout as its own error rather than hanging the caller", async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const error = new Error("timed out");
          error.name = "TimeoutError";
          reject(error);
        });
      });
    });

    await expect(
      checkExamineInteractions(items, {
        apiKey: "k",
        timeoutMs: 10,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/did not respond in time/);
  });

  it("wraps a transport failure", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(
      checkExamineInteractions(items, {
        apiKey: "k",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/could not be reached/);
  });
});

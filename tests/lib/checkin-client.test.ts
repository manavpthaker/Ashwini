import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConversationError,
  createRetrySafeCheckinWriter,
  postCheckin,
  type SubmittedTurn,
} from "@/lib/checkin-client";

const TURN: SubmittedTurn = {
  userMessageId: "00000000-0000-4000-8000-000000000001",
  text: "I ate lunch",
  timeZone: "America/New_York",
  ts: "2026-08-30T12:00:00.000Z",
  reply: { text: "Recorded.", kind: "record", receipt: "Recorded" },
  decisions: [],
  records: [],
  followUp: null,
  route: null,
  replayed: false,
};

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    dump: () => [...values.values()].join("\n"),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("browser check-in write identity", () => {
  it("bounds a stalled request and preserves the same key for an uncertain retry", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          }),
      )
      .mockResolvedValue(
        new Response(JSON.stringify({ ...TURN, userText: TURN.text }), { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const writer = createRetrySafeCheckinWriter(
      () => "same-write-key",
      postCheckin,
      memoryStorage(),
    );
    const pending = writer.submit("I ate lunch");
    const failed = expect(pending).rejects.toMatchObject({ status: 504 });
    // Fingerprinting is asynchronous before the request starts.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(75_000);
    await failed;
    await writer.submit("I ate lunch");
    expect(
      fetchMock.mock.calls.map(([, init]) => JSON.parse(init?.body as string).idempotencyKey),
    ).toEqual(["same-write-key", "same-write-key"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates caller cancellation and clears its deadline after success", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    caller.abort();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ...TURN, userText: TURN.text }), { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await postCheckin("I ate lunch", { idempotencyKey: "one", signal: caller.signal });
    expect(fetchMock.mock.calls[0]?.[1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sends the idempotency key through the conversation route contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ...TURN, userText: TURN.text }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await postCheckin("Correction: lunch was breakfast", {
      idempotencyKey: "00000000-0000-4000-8000-000000000002",
      correctionOf: "00000000-0000-4000-8000-000000000003",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      text: "Correction: lunch was breakfast",
      idempotencyKey: "00000000-0000-4000-8000-000000000002",
      correctionOf: "00000000-0000-4000-8000-000000000003",
    });
  });

  it("reuses one key after an uncertain failure and starts a new one after success", async () => {
    const send = vi
      .fn<typeof postCheckin>()
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValue(TURN)
      .mockResolvedValue(TURN);
    const ids = ["write-one", "write-two"];
    const writer = createRetrySafeCheckinWriter(() => ids.shift() as string, send);

    await expect(writer.submit("I ate lunch")).rejects.toThrow("response lost");
    await expect(writer.submit("I ate lunch")).resolves.toEqual(TURN);
    await expect(writer.submit("I ate lunch")).resolves.toEqual(TURN);

    expect(send.mock.calls.map(([, options]) => options.idempotencyKey)).toEqual([
      "write-one",
      "write-one",
      "write-two",
    ]);
  });

  it("reuses the unresolved key after a page reload without storing the draft", async () => {
    const storage = memoryStorage();
    const firstSend = vi.fn<typeof postCheckin>().mockRejectedValue(new TypeError("response lost"));
    const firstWriter = createRetrySafeCheckinWriter(() => "write-one", firstSend, storage);

    await expect(firstWriter.submit("Private health wording")).rejects.toThrow("response lost");
    expect(storage.dump()).not.toContain("Private health wording");

    const secondSend = vi.fn<typeof postCheckin>().mockResolvedValue({ ...TURN, replayed: true });
    const secondWriter = createRetrySafeCheckinWriter(() => "write-two", secondSend, storage);
    await expect(secondWriter.submit("Private health wording")).resolves.toMatchObject({
      replayed: true,
    });

    expect(secondSend.mock.calls[0]?.[1].idempotencyKey).toBe("write-one");
  });

  it("coalesces concurrent submissions for the same intent", async () => {
    let resolve: ((turn: SubmittedTurn) => void) | undefined;
    const send = vi.fn<typeof postCheckin>().mockImplementation(
      () =>
        new Promise<SubmittedTurn>((done) => {
          resolve = done;
        }),
    );
    const writer = createRetrySafeCheckinWriter(() => "write-one", send, memoryStorage());

    const first = writer.submit("I ate lunch");
    const second = writer.submit("I ate lunch");
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    resolve?.(TURN);

    await expect(Promise.all([first, second])).resolves.toEqual([TURN, TURN]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a key after a definitive rejection or for a different correction", async () => {
    const send = vi
      .fn<typeof postCheckin>()
      .mockRejectedValueOnce(new ConversationError("invalid", 400))
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValue(TURN);
    const ids = ["write-one", "write-two", "write-three"];
    const writer = createRetrySafeCheckinWriter(() => ids.shift() as string, send);

    await expect(writer.submit("Correction: breakfast", { correctionOf: "first" })).rejects.toThrow(
      "invalid",
    );
    await expect(writer.submit("Correction: breakfast", { correctionOf: "first" })).rejects.toThrow(
      "response lost",
    );
    await expect(
      writer.submit("Correction: breakfast", { correctionOf: "second" }),
    ).resolves.toEqual(TURN);

    expect(send.mock.calls.map(([, options]) => options.idempotencyKey)).toEqual([
      "write-one",
      "write-two",
      "write-three",
    ]);
  });
});

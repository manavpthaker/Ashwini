import type { ConversationTurn, WireRecordKind } from "@/lib/checkin-adapter";

/**
 * The browser's view of `/api/conversation`.
 *
 * Thin on purpose: it validates the shape enough not to crash a screen, and
 * leaves every product judgement to the server. Same-origin, so there is no base
 * URL to configure and no credential to hold — the session cookie the proxy
 * checks is already attached.
 */

export interface SubmittedTurn extends ConversationTurn {
  readonly userMessageId: string;
  readonly ts: string;
  readonly replayed: boolean;
}

export interface HistoricTurn extends ConversationTurn {
  readonly userMessageId: string;
  readonly ts: string;
  readonly correctedBy: string | null;
}

export class ConversationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ConversationError";
  }
}

interface PendingCheckinWrite {
  readonly fingerprint: string;
  readonly idempotencyKey: string;
}

interface PendingWriteStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PENDING_WRITE_KEY = "ashwini.pending-checkin-write.v1";

export interface CheckinWriter {
  submit(
    text: string,
    options?: { correctionOf?: string; signal?: AbortSignal },
  ): Promise<SubmittedTurn>;
}

async function readError(response: Response): Promise<never> {
  let detail = `The server returned ${response.status}.`;
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
      detail = body.error;
    }
  } catch {
    // A non-JSON error body is still an error; the status is what matters.
  }
  throw new ConversationError(detail, response.status);
}

export async function postCheckin(
  text: string,
  options: { idempotencyKey: string; correctionOf?: string; signal?: AbortSignal },
): Promise<SubmittedTurn> {
  // Longer than the server's 60-second route budget. A timeout is an uncertain
  // write, not a rejection: the writer must retain its original retry key.
  const controller = new AbortController();
  const cancel = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) cancel();
  else options.signal?.addEventListener("abort", cancel, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 75_000);
  try {
    const response = await fetch("/api/conversation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        idempotencyKey: options.idempotencyKey,
        ...(options.correctionOf ? { correctionOf: options.correctionOf } : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) await readError(response);

    const body = (await response.json()) as {
      userMessageId: string;
      userText: string;
      timeZone: string;
      ts: string;
      reply: SubmittedTurn["reply"];
      decisions: SubmittedTurn["decisions"];
      records: readonly WireRecordKind[];
      followUp: string | null;
      route: SubmittedTurn["route"];
      replayed: boolean;
    };

    return {
      userMessageId: body.userMessageId,
      text: body.userText,
      timeZone: body.timeZone,
      ts: body.ts,
      reply: body.reply,
      decisions: body.decisions,
      records: body.records,
      followUp: body.followUp,
      route: body.route,
      replayed: body.replayed,
    };
  } catch (error) {
    if (timedOut) {
      throw new ConversationError("The response took too long to confirm.", 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", cancel);
  }
}

/**
 * Own the identity of a browser write across an uncertain failure.
 *
 * A request can commit and still lose its response. Retrying that exact draft
 * with a fresh key would then create a second health record. This writer keeps
 * one key only while the same text/correction is unresolved, clears it after a
 * confirmed success or definitive client error, and starts a new key when the
 * user changes the intended write.
 */
export function createRetrySafeCheckinWriter(
  createId: () => string = () => crypto.randomUUID(),
  send: typeof postCheckin = postCheckin,
  storage: PendingWriteStorage | null = browserSessionStorage(),
): CheckinWriter {
  let pending: PendingCheckinWrite | null = readPendingWrite(storage);
  let inFlight: { fingerprint: string; promise: Promise<SubmittedTurn> } | null = null;

  return {
    async submit(text, options = {}) {
      const correctionOf = options.correctionOf;
      const fingerprint = await intentFingerprint(text, correctionOf);

      if (inFlight?.fingerprint === fingerprint) return inFlight.promise;

      const attempt =
        pending?.fingerprint === fingerprint
          ? pending
          : { fingerprint, idempotencyKey: createId() };
      pending = attempt;
      writePendingWrite(storage, attempt);

      const promise = (async () => {
        try {
          const turn = await send(text, {
            idempotencyKey: attempt.idempotencyKey,
            ...(correctionOf ? { correctionOf } : {}),
            ...(options.signal ? { signal: options.signal } : {}),
          });
          if (pending?.idempotencyKey === attempt.idempotencyKey) {
            pending = null;
            clearPendingWrite(storage);
          }
          return turn;
        } catch (cause) {
          // A 4xx proves the server rejected this write. Network failures,
          // malformed success responses, and 5xx responses are uncertain, so
          // the non-content fingerprint and key survive a page reload and can
          // ask the server for the stored replay.
          if (
            cause instanceof ConversationError &&
            cause.status >= 400 &&
            cause.status < 500 &&
            pending?.idempotencyKey === attempt.idempotencyKey
          ) {
            pending = null;
            clearPendingWrite(storage);
          }
          throw cause;
        }
      })();

      inFlight = { fingerprint, promise };
      try {
        return await promise;
      } finally {
        if (inFlight?.promise === promise) {
          inFlight = null;
        }
      }
    },
  };
}

async function intentFingerprint(text: string, correctionOf: string | undefined): Promise<string> {
  const intent = JSON.stringify([text, correctionOf ?? null]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(intent));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function browserSessionStorage(): PendingWriteStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function readPendingWrite(storage: PendingWriteStorage | null): PendingCheckinWrite | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PENDING_WRITE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      value &&
      typeof value === "object" &&
      "fingerprint" in value &&
      typeof value.fingerprint === "string" &&
      "idempotencyKey" in value &&
      typeof value.idempotencyKey === "string"
    ) {
      return { fingerprint: value.fingerprint, idempotencyKey: value.idempotencyKey };
    }
  } catch {
    // Corrupt or inaccessible session state cannot be trusted as a write key.
  }
  clearPendingWrite(storage);
  return null;
}

function writePendingWrite(
  storage: PendingWriteStorage | null,
  pending: PendingCheckinWrite,
): void {
  if (!storage) return;
  try {
    storage.setItem(PENDING_WRITE_KEY, JSON.stringify(pending));
  } catch {
    // Server idempotency still applies within this mounted page.
  }
}

function clearPendingWrite(storage: PendingWriteStorage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(PENDING_WRITE_KEY);
  } catch {
    // Nothing actionable: a later submission replaces stale state by intent.
  }
}

export async function fetchHistory(
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<{ readonly turns: readonly HistoricTurn[]; readonly timeZone: string }> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 50) });
  const response = await fetch(`/api/conversation?${query}`, {
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!response.ok) await readError(response);

  const body = (await response.json()) as {
    timeZone: string;
    turns: readonly {
      userMessage: { messageId: string; ts: string; text: string; correctedBy: string | null };
      reply: HistoricTurn["reply"] | null;
      decisions: HistoricTurn["decisions"];
      records: readonly WireRecordKind[];
      followUp: string | null;
      route: HistoricTurn["route"];
    }[];
  };

  return {
    timeZone: body.timeZone,
    turns: body.turns
      // A user message with no reply is a write that landed mid-failure. It is
      // real history, but there is no response to render, so it is not a turn.
      .filter((turn) => turn.reply !== null)
      .map((turn) => ({
        userMessageId: turn.userMessage.messageId,
        timeZone: body.timeZone,
        ts: turn.userMessage.ts,
        text: turn.userMessage.text,
        correctedBy: turn.userMessage.correctedBy,
        reply: turn.reply as NonNullable<typeof turn.reply>,
        decisions: turn.decisions,
        records: turn.records,
        followUp: turn.followUp,
        route: turn.route,
      })),
  };
}

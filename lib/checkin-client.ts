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
}

export interface HistoricTurn extends ConversationTurn {
  readonly userMessageId: string;
  readonly ts: string;
  readonly text: string;
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
  options: { correctionOf?: string; signal?: AbortSignal } = {},
): Promise<SubmittedTurn> {
  const response = await fetch("/api/conversation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text,
      ...(options.correctionOf ? { correctionOf: options.correctionOf } : {}),
    }),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!response.ok) await readError(response);

  const body = (await response.json()) as {
    userMessageId: string;
    reply: SubmittedTurn["reply"];
    decisions: SubmittedTurn["decisions"];
    records: readonly WireRecordKind[];
    followUp: string | null;
    route: SubmittedTurn["route"];
  };

  return {
    userMessageId: body.userMessageId,
    ts: new Date().toISOString(),
    reply: body.reply,
    decisions: body.decisions,
    records: body.records,
    followUp: body.followUp,
    route: body.route,
  };
}

export async function fetchHistory(
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<readonly HistoricTurn[]> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 50) });
  const response = await fetch(`/api/conversation?${query}`, {
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!response.ok) await readError(response);

  const body = (await response.json()) as {
    turns: readonly {
      userMessage: { messageId: string; ts: string; text: string; correctedBy: string | null };
      reply: HistoricTurn["reply"] | null;
      decisions: HistoricTurn["decisions"];
      records: readonly WireRecordKind[];
      followUp: string | null;
      route: HistoricTurn["route"];
    }[];
  };

  return (
    body.turns
      // A user message with no reply is a write that landed mid-failure. It is
      // real history, but there is no response to render, so it is not a turn.
      .filter((turn) => turn.reply !== null)
      .map((turn) => ({
        userMessageId: turn.userMessage.messageId,
        ts: turn.userMessage.ts,
        text: turn.userMessage.text,
        correctedBy: turn.userMessage.correctedBy,
        reply: turn.reply as NonNullable<typeof turn.reply>,
        decisions: turn.decisions,
        records: turn.records,
        followUp: turn.followUp,
        route: turn.route,
      }))
  );
}

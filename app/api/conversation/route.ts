import { z } from "zod";
import { db } from "@/server/db/client";
import { handleUtterance } from "@/server/advisor-service";

/**
 * The single conversational intake (PRD 4.3).
 *
 * A route handler rather than a Server Action, deliberately: an iOS Shortcut
 * posting "took my meds", or a launchd job running scheduled work, are likely
 * ingest paths here, and a Server Action is an opaque build-generated id that
 * nothing outside the app can call.
 */

export const dynamic = "force-dynamic";

const postSchema = z.object({
  text: z.string().trim().min(1, "An utterance cannot be empty.").max(4000),
  attachments: z
    .array(
      z.object({
        kind: z.enum(["image", "document"]),
        storagePath: z.string().min(1),
        mimeType: z.string().min(1),
      }),
    )
    .max(10)
    .optional(),
  /** Client-generated. Makes a replayed offline write land exactly once. */
  idempotencyKey: z.string().min(8).max(200).optional(),
  capturedAt: z.coerce.date().optional(),
});

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem(400, "Request body is not valid JSON.");
  }

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return problem(400, parsed.error.issues.map((issue) => issue.message).join(" "));
  }

  try {
    const result = await handleUtterance({
      text: parsed.data.text,
      attachments: parsed.data.attachments ?? [],
      ...(parsed.data.idempotencyKey ? { idempotencyKey: parsed.data.idempotencyKey } : {}),
      ...(parsed.data.capturedAt ? { capturedAt: parsed.data.capturedAt } : {}),
    });

    return Response.json(
      {
        userMessageId: result.userMessageId,
        advisorMessageId: result.advisorMessageId,
        decisionIds: result.decisionIds,
        replayed: result.replayed,
        reply: result.output.reply,
        // PRD 11.10: every model-generated output carries its evidence status
        // and provenance. Non-optional here, so a client cannot render a
        // recommendation without the label that qualifies it.
        decisions: result.output.decisions,
        followUp: result.output.followUp,
        route: result.output.route,
        trace: result.output.trace,
      },
      { status: result.replayed ? 200 : 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return problem(500, error instanceof Error ? error.message : "Unexpected failure.");
  }
}

const getSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.date().optional(),
});

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = getSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return problem(400, parsed.error.issues.map((issue) => issue.message).join(" "));
  }

  try {
    let query = db()
      .selectFrom("ashwini.messages")
      .select([
        "message_id",
        "ts",
        "role",
        "text",
        "kind",
        "receipt",
        "in_reply_to",
        "corrected_by",
        "rule_id",
      ])
      .orderBy("ts", "desc")
      .limit(parsed.data.limit);

    if (parsed.data.before) {
      query = query.where("ts", "<", parsed.data.before);
    }

    const messages = await query.execute();
    return Response.json(
      { messages: messages.reverse() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return problem(500, error instanceof Error ? error.message : "Unexpected failure.");
  }
}

function problem(status: number, detail: string): Response {
  return Response.json({ error: detail }, { status, headers: { "cache-control": "no-store" } });
}

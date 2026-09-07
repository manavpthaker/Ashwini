import { z } from "zod";
import { redactSensitiveContent } from "@/domain/advisor";
import { db } from "@/server/db/client";
import {
  CorrectionTargetError,
  handleUtterance,
  IdempotencyConflictError,
} from "@/server/advisor-service";
import { currentPrincipal } from "@/server/auth";
import { env } from "@/server/env";

/**
 * The single conversational intake (PRD 4.3).
 *
 * A route handler rather than a Server Action, deliberately: an iOS Shortcut
 * posting "took my meds", or a launchd job running scheduled work, are likely
 * ingest paths here, and a Server Action is an opaque build-generated id that
 * nothing outside the app can call.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  /** The earlier user message this corrects (PRD 4.4). */
  correctionOf: z.uuid().optional(),
});

export async function POST(request: Request): Promise<Response> {
  if (!(await currentPrincipal(request))) return problem(401, "Not signed in.");

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

  if (parsed.data.attachments?.length) {
    return problem(501, "Attachment intake is not connected on this deployment.");
  }

  try {
    const result = await handleUtterance({
      text: parsed.data.text,
      attachments: parsed.data.attachments ?? [],
      ...(parsed.data.idempotencyKey ? { idempotencyKey: parsed.data.idempotencyKey } : {}),
      ...(parsed.data.capturedAt ? { capturedAt: parsed.data.capturedAt } : {}),
      ...(parsed.data.correctionOf ? { correctionOf: parsed.data.correctionOf } : {}),
    });

    // A delayed offline retry can arrive after the user has already answered
    // the decision created by this check-in. Replaying the immutable turn with
    // `response: null` would make the same idempotency key return a false,
    // earlier state. Read the durable response only for replays; a newly created
    // decision cannot have been exposed to a responder yet.
    const persistedResponses =
      result.replayed && result.decisionIds.length > 0
        ? await db()
            .selectFrom("ashwini.decision_responses")
            .select(["decision_id", "choice", "responded_ts"])
            .where("decision_id", "in", result.decisionIds)
            .execute()
        : [];
    const responseByDecisionId = new Map(
      persistedResponses.map((response) => [response.decision_id, response]),
    );

    const decisions = result.output.decisions.map((decision, index) => {
      const decisionId = result.decisionIds[index];
      if (!decisionId) {
        throw new Error("A persisted decision is missing its durable identifier.");
      }
      const response = responseByDecisionId.get(decisionId);
      return {
        ...decision,
        decisionId,
        response: response
          ? { choice: response.choice, respondedAt: response.responded_ts.toISOString() }
          : null,
      };
    });

    return Response.json(
      {
        userMessageId: result.userMessageId,
        userText: result.userText,
        timeZone: env().ASHWINI_TIME_ZONE,
        ts: result.ts.toISOString(),
        advisorMessageId: result.advisorMessageId,
        decisionIds: result.decisionIds,
        replayed: result.replayed,
        reply: result.output.reply,
        // PRD 11.10: every model-generated output carries its evidence status
        // and provenance. Non-optional here, so a client cannot render a
        // recommendation without the label that qualifies it.
        decisions,
        // Kinds only. PRD 4.3 wants the user shown what was recorded, and the
        // kind is the whole of that; the drafts also carry the user's own
        // wording, which does not need a round trip to be displayed.
        records: result.output.records.map((record) => record.kind),
        followUp: result.output.followUp,
        route: result.output.route,
        trace: result.output.trace,
      },
      { status: result.replayed ? 200 : 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof IdempotencyConflictError) return problem(409, error.message);
    if (error instanceof CorrectionTargetError) return problem(409, error.message);
    console.error("Check-in write failed", error);
    return problem(503, "The check-in record is temporarily unavailable.");
  }
}

const getSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.date().optional(),
});

/**
 * History, assembled into turns.
 *
 * A turn is the user's message, the advisor's reply, the decision it produced,
 * and the kinds of record it wrote. The interface reduces the day's state over
 * exactly this, so returning bare message rows would mean a reload showed the
 * text of a blocked training verdict without the block — the record surviving in
 * appearance only. `limit` counts turns, not rows.
 */
export async function GET(request: Request): Promise<Response> {
  if (!(await currentPrincipal(request))) return problem(401, "Not signed in.");

  const url = new URL(request.url);
  const parsed = getSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return problem(400, parsed.error.issues.map((issue) => issue.message).join(" "));
  }

  try {
    const kysely = db();
    const timeZone = env().ASHWINI_TIME_ZONE;
    let query = kysely
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
      .where("role", "=", "user")
      .orderBy("ts", "desc")
      .orderBy("message_id", "desc")
      .limit(parsed.data.limit);

    if (parsed.data.before) {
      query = query.where("ts", "<", parsed.data.before);
    }

    const userMessages = (await query.execute()).reverse();
    const userIds = userMessages.map((message) => message.message_id);

    if (userIds.length === 0) {
      return Response.json(
        { turns: [], timeZone },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const replies = await kysely
      .selectFrom("ashwini.messages")
      .select(["message_id", "ts", "text", "kind", "receipt", "in_reply_to", "rule_id"])
      .where("role", "=", "ashwini")
      .where("in_reply_to", "in", userIds)
      .execute();

    const advisorIds = replies.map((reply) => reply.message_id);

    const [decisions, routed] = await Promise.all([
      advisorIds.length === 0
        ? []
        : kysely
            .selectFrom("ashwini.decisions")
            .select([
              "message_id",
              "decision_id",
              "type",
              "domain",
              "evidence_status",
              "gate_outcome",
              "gate_reason",
              "confidence_note",
              "target",
              "refused",
              "choices",
              "route_destination",
            ])
            .where("message_id", "in", advisorIds)
            .orderBy("created_ts", "asc")
            .execute(),
      kysely
        .selectFrom("ashwini.routed_records")
        .select(["message_id", "record_kind"])
        .where("message_id", "in", userIds)
        .execute(),
    ]);

    const decisionIds = decisions.map((decision) => decision.decision_id);
    const decisionResponses =
      decisionIds.length === 0
        ? []
        : await kysely
            .selectFrom("ashwini.decision_responses")
            .select(["decision_id", "choice", "responded_ts"])
            .where("decision_id", "in", decisionIds)
            .execute();

    const replyByUserId = new Map(replies.map((reply) => [reply.in_reply_to, reply]));
    const decisionsByAdvisorId = groupBy(decisions, (row) => row.message_id);
    const routedByUserId = groupBy(routed, (row) => row.message_id);
    const responseByDecisionId = new Map(
      decisionResponses.map((response) => [response.decision_id, response]),
    );

    const turns = userMessages.map((message) => {
      const reply = replyByUserId.get(message.message_id);
      const rows = reply ? (decisionsByAdvisorId.get(reply.message_id) ?? []) : [];
      return {
        userMessage: {
          messageId: message.message_id,
          ts: message.ts,
          // Defense in depth for pre-boundary rows: recognized crisis or
          // therapy wording never reaches rendered history even if an older
          // deployment stored it before the persistence classifier existed.
          text: redactSensitiveContent(message.text),
          correctedBy: message.corrected_by,
        },
        reply: reply ? { text: reply.text, kind: reply.kind, receipt: reply.receipt ?? "" } : null,
        decisions: rows.map((row) => ({
          decisionId: row.decision_id,
          type: row.type,
          domain: row.domain,
          evidenceStatus: row.evidence_status,
          gateOutcome: row.gate_outcome,
          gateReason: row.gate_reason,
          confidenceNote: row.confidence_note,
          target: row.target,
          refused: row.refused,
          choices: Array.isArray(row.choices)
            ? row.choices.filter((choice): choice is string => typeof choice === "string")
            : [],
          response: responseByDecisionId.has(row.decision_id)
            ? {
                choice: responseByDecisionId.get(row.decision_id)!.choice,
                respondedAt: responseByDecisionId
                  .get(row.decision_id)!
                  .responded_ts.toISOString(),
              }
            : null,
        })),
        records: (routedByUserId.get(message.message_id) ?? []).map((row) => row.record_kind),
        // A follow-up is asked in the reply itself; it is not stored separately,
        // so replaying history must not re-ask it.
        followUp: null,
        route: rows[0]?.route_destination ?? null,
      };
    });

    return Response.json({ turns, timeZone }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Check-in history query failed", error);
    return problem(503, "Check-in history is temporarily unavailable.");
  }
}

function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const row of rows) {
    const bucket = grouped.get(key(row));
    if (bucket) bucket.push(row);
    else grouped.set(key(row), [row]);
  }
  return grouped;
}

function problem(status: number, detail: string): Response {
  return Response.json({ error: detail }, { status, headers: { "cache-control": "no-store" } });
}

import { z } from "zod";
import { currentPrincipal } from "@/server/auth";
import { db } from "@/server/db/client";

/**
 * Record what the user did about a decision (PRD 9).
 *
 * This is the half that makes Ashwini accountable: without it, the system can
 * say what it recommended but never whether the suggestion was useful, ignored,
 * impossible, or wrong.
 *
 * An override — choosing something the decision's own gate advised against — is
 * accepted, but PRD 8 requires it to be explicit and permanently retained with
 * the output it affected, so the reason is mandatory and the row is immutable.
 */

export const dynamic = "force-dynamic";

const schema = z.object({
  choice: z.string().trim().min(1).max(200).optional(),
  acknowledge: z.boolean().default(false),
  note: z.string().trim().max(2000).optional(),
  wasOverride: z.boolean().default(false),
  overrideReason: z.string().trim().max(2000).optional(),
}).superRefine((value, context) => {
  if (value.acknowledge) {
    if (value.choice !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["choice"],
        message: "An acknowledgment cannot also choose an option.",
      });
    }
    if (value.wasOverride || value.overrideReason !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["wasOverride"],
        message: "An acknowledgment is not an override.",
      });
    }
    return;
  }

  if (value.choice === undefined) {
    context.addIssue({
      code: "custom",
      path: ["choice"],
      message: "Choose one of the offered options.",
    });
  }
});

interface ResponseIntent {
  readonly choice: string;
  readonly note: string | null;
  readonly wasOverride: boolean;
  readonly overrideReason: string | null;
}

interface StoredResponse extends ResponseIntent {
  readonly responseId: string;
  readonly respondedAt: Date;
}

type ResponseOutcome =
  | { readonly problem: Response }
  | (StoredResponse & { readonly replayed: boolean });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!(await currentPrincipal(request))) {
    return problem(401, "Not signed in.");
  }

  const { id } = await params;

  if (!z.string().uuid().safeParse(id).success) {
    return problem(400, "That is not a decision id.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem(400, "Request body is not valid JSON.");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return problem(400, parsed.error.issues.map((issue) => issue.message).join(" "));
  }

  const { choice, acknowledge, note, wasOverride, overrideReason } = parsed.data;

  if (wasOverride && !overrideReason) {
    return problem(
      400,
      "An override has to say why. PRD 8 keeps the reason permanently with the output it affected.",
    );
  }

  const intent: ResponseIntent = {
    choice: acknowledge ? "Acknowledged" : (choice as string),
    note: note ?? null,
    wasOverride: acknowledge ? false : wasOverride,
    overrideReason: acknowledge ? null : (overrideReason ?? null),
  };

  try {
    const outcome: ResponseOutcome = await db()
      .transaction()
      .execute(async (trx) => {
        // The decision row is the lock. Two responders to the same decision must
        // serialize before either checks for an existing immutable response.
        const decision = await trx
          .selectFrom("ashwini.decisions")
          .select([
            "decision_id",
            "type",
            "choices",
            "expires_at",
            "message_id",
            "route_destination",
          ])
          .where("decision_id", "=", id)
          .forUpdate()
          .executeTakeFirst();

        if (!decision) return { problem: problem(404, "No such decision.") } as const;

        const offered = Array.isArray(decision.choices) ? (decision.choices as string[]) : [];
        const canAcknowledge =
          offered.length === 0 &&
          (decision.type === "route_out" ||
            decision.type === "data_quality_block" ||
            decision.route_destination !== null);

        if (acknowledge && !canAcknowledge) {
          return {
            problem: problem(
              400,
              "Only a no-choice safety route or data-quality block can be acknowledged.",
            ),
          } as const;
        }

        // `choice` is required by schema when this is not an acknowledgment.
        if (!acknowledge && !offered.includes(intent.choice) && !wasOverride) {
          return {
            problem: problem(
              400,
              `"${intent.choice}" was not one of the offered choices. Send wasOverride with a reason to record it anyway.`,
            ),
          } as const;
        }

        const existing = await trx
          .selectFrom("ashwini.decision_responses")
          .select([
            "response_id",
            "responded_ts",
            "choice",
            "note",
            "was_override",
            "override_reason",
          ])
          .where("decision_id", "=", id)
          .executeTakeFirst();
        if (existing) {
          if (sameResponseIntent(existing, intent)) {
            return { ...toStoredResponse(existing), replayed: true } as const;
          }
          return { problem: problem(409, "That decision has already been answered.") } as const;
        }

        // A response that already landed remains safely replayable after the
        // decision expires or its source is corrected. These checks apply only
        // to a new mutation.
        if (decision.expires_at && decision.expires_at <= new Date()) {
          return {
            problem: problem(409, "That decision has expired and is no longer open."),
          } as const;
        }

        if (decision.message_id) {
          const advisorMessage = await trx
            .selectFrom("ashwini.messages")
            .select("in_reply_to")
            .where("message_id", "=", decision.message_id)
            .executeTakeFirst();

          if (advisorMessage?.in_reply_to) {
            // A correction updates this source row. The shared lock makes that
            // race resolve in a defined order instead of answering a stale action.
            const source = await trx
              .selectFrom("ashwini.messages")
              .select("corrected_by")
              .where("message_id", "=", advisorMessage.in_reply_to)
              .forShare()
              .executeTakeFirst();
            if (source?.corrected_by) {
              return {
                problem: problem(409, "That decision was superseded by a correction."),
              } as const;
            }
          }
        }

        const response = await trx
          .insertInto("ashwini.decision_responses")
          .values({
            decision_id: id,
            choice: intent.choice,
            note: intent.note,
            was_override: intent.wasOverride,
            override_reason: intent.overrideReason,
          })
          .returning(["response_id", "responded_ts"])
          .executeTakeFirstOrThrow();

        return {
          responseId: response.response_id,
          respondedAt: response.responded_ts,
          ...intent,
          replayed: false,
        } as const;
      });

    if ("problem" in outcome) return outcome.problem;

    return responseResult(outcome, outcome.replayed ? 200 : 201);
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Every application writer locks the decision first, so this is mainly
      // defense against a future script that relies only on the unique index.
      // If it wrote the same intent, recover the committed result; otherwise
      // preserve the immutable conflict.
      try {
        const existing = await loadStoredResponse(id);
        if (existing && sameResponseIntent(existing, intent)) {
          return responseResult(existing, 200);
        }
      } catch (readError) {
        console.error("Decision response recovery failed", readError);
        return problem(503, "The response was recorded, but could not be read back just now.");
      }
      return problem(409, "That decision has already been answered.");
    }
    console.error("Decision response write failed", error);
    return problem(503, "The response could not be recorded just now.");
  }
}

async function loadStoredResponse(decisionId: string): Promise<StoredResponse | null> {
  const row = await db()
    .selectFrom("ashwini.decision_responses")
    .select([
      "response_id",
      "responded_ts",
      "choice",
      "note",
      "was_override",
      "override_reason",
    ])
    .where("decision_id", "=", decisionId)
    .executeTakeFirst();
  return row ? toStoredResponse(row) : null;
}

function toStoredResponse(row: {
  response_id: string;
  responded_ts: Date;
  choice: string;
  note: string | null;
  was_override: boolean;
  override_reason: string | null;
}): StoredResponse {
  return {
    responseId: row.response_id,
    respondedAt: row.responded_ts,
    choice: row.choice,
    note: row.note,
    wasOverride: row.was_override,
    overrideReason: row.override_reason,
  };
}

function sameResponseIntent(
  stored: {
    choice: string;
    note: string | null;
    was_override: boolean;
    override_reason: string | null;
  } | StoredResponse,
  intent: ResponseIntent,
): boolean {
  const wasOverride = "was_override" in stored ? stored.was_override : stored.wasOverride;
  const overrideReason =
    "override_reason" in stored ? stored.override_reason : stored.overrideReason;
  return (
    stored.choice === intent.choice &&
    stored.note === intent.note &&
    wasOverride === intent.wasOverride &&
    overrideReason === intent.overrideReason
  );
}

function responseResult(response: StoredResponse, status: 200 | 201): Response {
  return Response.json(
    {
      responseId: response.responseId,
      respondedAt: response.respondedAt.toISOString(),
      replayed: status === 200,
    },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

function problem(status: number, detail: string): Response {
  return Response.json({ error: detail }, { status, headers: { "cache-control": "no-store" } });
}

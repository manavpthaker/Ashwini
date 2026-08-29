import { z } from "zod";
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
  choice: z.string().trim().min(1).max(200),
  note: z.string().trim().max(2000).optional(),
  wasOverride: z.boolean().default(false),
  overrideReason: z.string().trim().max(2000).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
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

  const { choice, note, wasOverride, overrideReason } = parsed.data;

  if (wasOverride && !overrideReason) {
    return problem(
      400,
      "An override has to say why. PRD 8 keeps the reason permanently with the output it affected.",
    );
  }

  try {
    const decision = await db()
      .selectFrom("ashwini.decisions")
      .select(["decision_id", "choices"])
      .where("decision_id", "=", id)
      .executeTakeFirst();

    if (!decision) return problem(404, "No such decision.");

    const offered = Array.isArray(decision.choices) ? (decision.choices as string[]) : [];
    if (offered.length > 0 && !offered.includes(choice) && !wasOverride) {
      return problem(
        400,
        `"${choice}" was not one of the offered choices. Send wasOverride with a reason to record it anyway.`,
      );
    }

    const response = await db()
      .insertInto("ashwini.decision_responses")
      .values({
        decision_id: id,
        responded_ts: new Date(),
        choice,
        note: note ?? null,
        was_override: wasOverride,
        override_reason: overrideReason ?? null,
      })
      .returning("response_id")
      .executeTakeFirstOrThrow();

    return Response.json(
      { responseId: response.response_id },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return problem(500, error instanceof Error ? error.message : "Unexpected failure.");
  }
}

function problem(status: number, detail: string): Response {
  return Response.json({ error: detail }, { status, headers: { "cache-control": "no-store" } });
}

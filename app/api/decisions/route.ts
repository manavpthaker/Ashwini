import { z } from "zod";
import { sql } from "kysely";
import { currentPrincipal } from "@/server/auth";
import { db } from "@/server/db/client";

/** Persisted, unresolved decisions (PRD 9). */

export const dynamic = "force-dynamic";

const schema = z.object({
  includeExpired: z.enum(["0", "1"]).default("0"),
  limit: z.coerce.number().int().min(1).max(100).default(100),
});

export async function GET(request: Request): Promise<Response> {
  if (!(await currentPrincipal(request))) {
    return problem(401, "NOT_SIGNED_IN", "Not signed in.");
  }

  const url = new URL(request.url);
  const parsed = schema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return problem(
      400,
      "INVALID_QUERY",
      parsed.error.issues.map((issue) => issue.message).join(" "),
    );
  }

  try {
    let query = db()
      .selectFrom("ashwini.decisions as decision")
      .leftJoin(
        "ashwini.decision_responses as response",
        "response.decision_id",
        "decision.decision_id",
      )
      .leftJoin(
        "ashwini.messages as advisor_message",
        "advisor_message.message_id",
        "decision.message_id",
      )
      .leftJoin(
        "ashwini.messages as source_message",
        "source_message.message_id",
        "advisor_message.in_reply_to",
      )
      .select([
        "decision.decision_id",
        "decision.created_ts",
        "decision.type",
        "decision.domain",
        "decision.evidence_status",
        "decision.ladder_level",
        "decision.confidence_note",
        "decision.gate_outcome",
        "decision.gate_reason",
        "decision.target",
        "decision.expected_lag",
        "decision.choices",
        "decision.refused",
        "decision.expires_at",
        "decision.route_destination",
        "decision.rule_id",
        "decision.advisor_version",
        "advisor_message.text as reply_text",
        "advisor_message.receipt as reply_receipt",
        "source_message.message_id as source_message_id",
      ])
      .where("response.response_id", "is", null)
      // Corrections keep the prior decision in history, but close its action.
      .where("source_message.corrected_by", "is", null)
      // A persisted decision is not automatically an action for the user.
      // Record-only advisor outputs deliberately carry no choices and no route;
      // keeping them out here prevents the UI from presenting an inert log row
      // as an unresolved prompt. Safety routes and data-quality blocks remain
      // actionable because the user can explicitly acknowledge them.
      .where((eb) =>
        eb.or([
          sql<boolean>`case
            when jsonb_typeof("decision"."choices") = 'array'
              then jsonb_array_length("decision"."choices") > 0
            else false
          end`,
          eb("decision.route_destination", "is not", null),
          eb("decision.type", "in", ["route_out", "data_quality_block"]),
        ]),
      )
      .orderBy(
        sql<number>`case
          when "decision"."route_destination" in ('emergency', 'crisis_line') then 0
          when "decision"."type" = 'route_out' then 1
          when "decision"."gate_outcome" = 'blocked' then 2
          else 3
        end`,
        "asc",
      )
      .orderBy("decision.created_ts", "desc")
      .limit(parsed.data.limit);

    if (parsed.data.includeExpired === "0") {
      query = query.where((eb) =>
        eb.or([
          eb("decision.expires_at", "is", null),
          eb("decision.expires_at", ">", new Date()),
        ]),
      );
    }

    const rows = await query.execute();
    const decisions = rows
      .map((row) => ({
        decisionId: row.decision_id,
        createdAt: row.created_ts.toISOString(),
        type: row.type,
        domain: row.domain,
        evidenceStatus: row.evidence_status,
        ladderLevel: row.ladder_level,
        confidenceNote: row.confidence_note,
        gateOutcome: row.gate_outcome,
        gateReason: row.gate_reason,
        target: row.target,
        expectedLag: row.expected_lag,
        choices: Array.isArray(row.choices)
          ? row.choices.filter((choice): choice is string => typeof choice === "string")
          : [],
        refused: row.refused,
        expiresAt: row.expires_at?.toISOString() ?? null,
        route: row.route_destination,
        ruleId: row.rule_id,
        advisorVersion: row.advisor_version,
        reply: {
          text: row.reply_text ?? "",
          receipt: row.reply_receipt ?? "",
        },
        sourceMessageId: row.source_message_id,
      }))
      .sort(compareDecisionPriority);

    return Response.json(
      { decisions },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("Open decision query failed", error);
    return problem(503, "DECISIONS_UNAVAILABLE", "Current decisions are temporarily unavailable.");
  }
}

function compareDecisionPriority(
  left: { type: string; route: string | null; gateOutcome: string; createdAt: string },
  right: { type: string; route: string | null; gateOutcome: string; createdAt: string },
): number {
  const priority = (decision: typeof left) => {
    if (decision.route === "emergency" || decision.route === "crisis_line") return 0;
    if (decision.type === "route_out") return 1;
    if (decision.gateOutcome === "blocked") return 2;
    return 3;
  };
  return priority(left) - priority(right) || right.createdAt.localeCompare(left.createdAt);
}

function problem(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

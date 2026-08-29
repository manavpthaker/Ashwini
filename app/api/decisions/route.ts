import { z } from "zod";
import { db } from "@/server/db/client";

/**
 * Open decisions (PRD 9).
 *
 * "Open" means not yet responded to and not yet expired. A decision that has
 * expired is not silently dropped from history — it stops being actionable, and
 * PRD 9 wants the record to distinguish "ignored" from "never answered".
 */

export const dynamic = "force-dynamic";

const schema = z.object({
  includeExpired: z.enum(["0", "1"]).default("0"),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = schema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((issue) => issue.message).join(" ") },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    let query = db()
      .selectFrom("ashwini.decisions")
      .leftJoin(
        "ashwini.decision_responses",
        "ashwini.decision_responses.decision_id",
        "ashwini.decisions.decision_id",
      )
      .select([
        "ashwini.decisions.decision_id",
        "ashwini.decisions.created_ts",
        "ashwini.decisions.type",
        "ashwini.decisions.domain",
        "ashwini.decisions.evidence_status",
        "ashwini.decisions.ladder_level",
        "ashwini.decisions.confidence_note",
        "ashwini.decisions.gate_outcome",
        "ashwini.decisions.gate_reason",
        "ashwini.decisions.confounds_checked",
        "ashwini.decisions.target",
        "ashwini.decisions.expected_lag",
        "ashwini.decisions.choices",
        "ashwini.decisions.refused",
        "ashwini.decisions.expires_at",
        "ashwini.decisions.route_destination",
        "ashwini.decisions.rule_id",
        "ashwini.decisions.advisor_version",
      ])
      .where("ashwini.decision_responses.response_id", "is", null)
      .orderBy("ashwini.decisions.created_ts", "desc")
      .limit(parsed.data.limit);

    if (parsed.data.includeExpired === "0") {
      query = query.where((eb) =>
        eb.or([
          eb("ashwini.decisions.expires_at", "is", null),
          eb("ashwini.decisions.expires_at", ">", new Date()),
        ]),
      );
    }

    return Response.json(
      { decisions: await query.execute() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unexpected failure." },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

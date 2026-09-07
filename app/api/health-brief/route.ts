import { systemClock } from "@/domain/clock";
import { composeHealthBrief } from "@/lib/health-brief";
import { currentPrincipal } from "@/server/auth";
import { buildHealthHistory, buildHealthObservationContext } from "@/server/context";
import { env } from "@/server/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  if (!(await currentPrincipal(request))) {
    return Response.json({ error: "Not signed in." }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  try {
    const clock = systemClock(env().ASHWINI_TIME_ZONE);
    const [history, observations] = await Promise.all([buildHealthHistory(), buildHealthObservationContext(clock)]);
    const brief = composeHealthBrief({
      history,
      coverage: observations.healthObservationCoverage ?? [],
      generatedAt: clock.now().toISOString(),
      timeZone: clock.timeZone(),
    });
    return Response.json(brief, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "Your health brief is temporarily unavailable." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

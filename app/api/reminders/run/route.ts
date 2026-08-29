import { systemClock } from "@/domain/clock";
import { env } from "@/server/env";
import { runReminders } from "@/server/reminders/run";

/**
 * The scheduler tick.
 *
 * Called by Vercel Cron (see vercel.json) or by a launchd timer on a
 * self-hosted box. This is also the answer to PRD 11.8's "must not depend
 * solely on the Mac mini": a hosted cron fires whether or not that machine is
 * awake.
 *
 * It authenticates on a shared secret rather than a user session, because the
 * caller is a scheduler with no session to present. proxy.ts lets it through on
 * that basis, so this check is the only thing standing in front of it — without
 * ASHWINI_CRON_SECRET set, the route refuses rather than running openly.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.ASHWINI_CRON_SECRET;

  if (!secret) {
    return Response.json(
      { error: "ASHWINI_CRON_SECRET is not configured; the scheduler endpoint is disabled." },
      { status: 501, headers: { "cache-control": "no-store" } },
    );
  }

  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; a launchd curl can
  // send the same header.
  const presented = request.headers.get("authorization");
  if (presented !== `Bearer ${secret}`) {
    return Response.json(
      { error: "Not authorised." },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const clock = systemClock(env().ASHWINI_TIME_ZONE);
    const result = await runReminders(clock.now());
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Reminder run failed." },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

/** GET mirrors POST so a scheduler that only issues GETs can drive it too. */
export const GET = POST;

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { fixedClock } from "@/domain/clock";

const connectionString = process.env.ASHWINI_TEST_DATABASE_URL;
const describeIfDb = connectionString ? describe : describe.skip;

describeIfDb("record-backed product surfaces", () => {
  let client: Client;
  let closeDb: typeof import("@/server/db/client").closeDb;
  let handleUtterance: typeof import("@/server/advisor-service").handleUtterance;
  let buildSubjectContext: typeof import("@/server/context").buildSubjectContext;
  let todayGET: typeof import("@/app/api/today/route").GET;
  let planGET: typeof import("@/app/api/plan/route").GET;
  let decisionsGET: typeof import("@/app/api/decisions/route").GET;
  let respondPOST: typeof import("@/app/api/decisions/[id]/respond/route").POST;
  let conversationPOST: typeof import("@/app/api/conversation/route").POST;

  beforeAll(async () => {
    (process.env as Record<string, string | undefined>).DATABASE_URL = connectionString;
    (process.env as Record<string, string | undefined>).ASHWINI_TIME_ZONE = "UTC";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.ASHWINI_ALLOWED_EMAILS;
    delete process.env.ASHWINI_TAILSCALE_USER;

    ({ closeDb } = await import("@/server/db/client"));
    ({ handleUtterance } = await import("@/server/advisor-service"));
    ({ buildSubjectContext } = await import("@/server/context"));
    ({ GET: todayGET } = await import("@/app/api/today/route"));
    ({ GET: planGET } = await import("@/app/api/plan/route"));
    ({ GET: decisionsGET } = await import("@/app/api/decisions/route"));
    ({ POST: respondPOST } = await import("@/app/api/decisions/[id]/respond/route"));
    ({ POST: conversationPOST } = await import("@/app/api/conversation/route"));

    client = new Client({ connectionString });
    await client.connect();
  });

  afterAll(async () => {
    await closeDb?.();
    await client?.end();
  });

  async function insertOpenDecision(
    options: {
      choices?: readonly string[];
      expiresAt?: Date | null;
      corrected?: boolean;
      type?: "recommendation" | "data_quality_block" | "scheduled_review" | "route_out";
      route?:
        | "emergency"
        | "crisis_line"
        | "clinician"
        | "pharmacist"
        | "prescriber"
        | "dermatologist"
        | null;
    } = {},
  ): Promise<string> {
    const source = await client.query<{ message_id: string }>(
      "insert into ashwini.messages (role, text, kind) values ('user', $1, 'record') returning message_id",
      [`Decision source ${crypto.randomUUID()}`],
    );
    if (options.corrected) {
      const replacement = await client.query<{ message_id: string }>(
        "insert into ashwini.messages (role, text, kind) values ('user', 'replacement', 'record') returning message_id",
      );
      await client.query("update ashwini.messages set corrected_by = $1 where message_id = $2", [
        replacement.rows[0]?.message_id,
        source.rows[0]?.message_id,
      ]);
    }
    const advisor = await client.query<{ message_id: string }>(
      `insert into ashwini.messages
       (role, text, kind, receipt, in_reply_to, advisor_version, rule_id)
       values ('ashwini', 'Stored reply', 'recommendation', 'Stored receipt', $1, 'test-advisor', 'test-rule')
       returning message_id`,
      [source.rows[0]?.message_id],
    );
    const decision = await client.query<{ decision_id: string }>(
      `insert into ashwini.decisions
       (type, domain, evidence_status, ladder_level, confidence_note,
        gate_outcome, gate_reason, choices, refused, expires_at,
        advisor_version, rule_id, message_id, route_destination)
       values ($3::ashwini.decision_type, 'nutrition', 'recorded', 0, 'Stored confidence',
               'clear', 'Stored gate reason', $1::jsonb, 'No extra claim', $2,
               'test-advisor', 'test-rule', $4, $5::ashwini.route_destination)
       returning decision_id`,
      [
        JSON.stringify(options.choices ?? ["Stored choice"]),
        options.expiresAt ?? null,
        options.type ?? "recommendation",
        advisor.rows[0]?.message_id,
        options.route ?? null,
      ],
    );
    return decision.rows[0]?.decision_id as string;
  }

  function responseRequest(decisionId: string, choice = "Stored choice"): Request {
    return new Request(`http://ashwini.test/api/decisions/${decisionId}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ choice }),
    });
  }

  it("returns only stored commitments on Today", async () => {
    const title = `Live commitment ${crypto.randomUUID()}`;
    await client.query(
      `insert into ashwini.commitments (starts_at, domain, title, kind)
       values (now(), 'system', $1, 'other')`,
      [title],
    );

    const response = await todayGET(new Request("http://ashwini.test/api/today"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { commitments: { title: string }[] };
    expect(body.commitments.some((commitment) => commitment.title === title)).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/6h 18m|3:45|4:30|House Dal/);
  });

  it("replays the browser route write when the same idempotency key is retried", async () => {
    const key = `browser-${crypto.randomUUID()}`;
    const text = `I feel flat today ${crypto.randomUUID()}`;
    const request = () =>
      new Request("http://ashwini.test/api/conversation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, idempotencyKey: key }),
      });

    const first = await conversationPOST(request());
    const second = await conversationPOST(request());
    const firstBody = (await first.json()) as {
      userMessageId: string;
      advisorMessageId: string;
      replayed: boolean;
    };
    const secondBody = (await second.json()) as typeof firstBody;

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(firstBody.replayed).toBe(false);
    expect(secondBody.replayed).toBe(true);
    expect(secondBody.userMessageId).toBe(firstBody.userMessageId);
    expect(secondBody.advisorMessageId).toBe(firstBody.advisorMessageId);
  });

  it("includes a taken-only PRN dose in Today", async () => {
    const medicationName = `PRN ${crypto.randomUUID()}`;
    const medication = await client.query<{ med_id: string }>(
      `insert into ashwini.medications (name, dose, unit, prn, started_at)
       values ($1, 1, 'unit', true, current_date)
       returning med_id`,
      [medicationName],
    );
    await client.query(
      `insert into ashwini.doses (med_id, scheduled_ts, taken_ts)
       values ($1, null, now())`,
      [medication.rows[0]?.med_id],
    );

    const response = await todayGET(new Request("http://ashwini.test/api/today"));
    const body = (await response.json()) as {
      doses: { scheduledAt: string | null; takenAt: string | null; medication: { name: string } }[];
    };
    const dose = body.doses.find((item) => item.medication.name === medicationName);
    expect(dose?.scheduledAt).toBeNull();
    expect(dose?.takenAt).toBeTruthy();
  });

  it("removes a corrected meal from Today and future advisor context", async () => {
    const original = await handleUtterance({ text: "I ate lunch" });
    await handleUtterance({
      text: "Correction: that record was wrong",
      correctionOf: original.userMessageId,
    });

    const today = await todayGET(new Request("http://ashwini.test/api/today"));
    const body = (await today.json()) as { meals: { messageId: string | null }[] };
    expect(body.meals.some((meal) => meal.messageId === original.userMessageId)).toBe(false);

    const farOriginal = await client.query<{ message_id: string }>(
      `insert into ashwini.messages (ts, role, text, kind)
       values ('2098-07-15T10:00:00Z', 'user', 'far meal', 'record')
       returning message_id`,
    );
    const farCorrection = await client.query<{ message_id: string }>(
      `insert into ashwini.messages (ts, role, text, kind)
       values ('2098-07-15T10:01:00Z', 'user', 'far correction', 'record')
       returning message_id`,
    );
    await client.query("update ashwini.messages set corrected_by = $1 where message_id = $2", [
      farCorrection.rows[0]?.message_id,
      farOriginal.rows[0]?.message_id,
    ]);
    await client.query(
      `insert into ashwini.meals (ts, kind, source, confidence, message_id)
       values ('2098-07-15T10:00:00Z', 'lunch', 'text', 'low', $1)`,
      [farOriginal.rows[0]?.message_id],
    );

    const context = await buildSubjectContext(fixedClock("2098-07-15T12:00:00Z", "UTC"));
    expect(context.mealsToday).toEqual([]);
  });

  it("offers the advisor only same-day upcoming commitments", async () => {
    const sameDay = `Same day ${crypto.randomUUID()}`;
    const later = `Later ${crypto.randomUUID()}`;
    await client.query(
      `insert into ashwini.commitments (starts_at, domain, title, kind)
       values
         ('2099-04-12T15:00:00Z', 'training', $1, 'training'),
         ('2099-04-13T10:00:00Z', 'training', $2, 'training')`,
      [sameDay, later],
    );

    const context = await buildSubjectContext(fixedClock("2099-04-12T12:00:00Z", "UTC"));
    expect(context.commitments.map((item) => item.title)).toContain(sameDay);
    expect(context.commitments.map((item) => item.title)).not.toContain(later);
  });

  it("uses one deterministic latest same-day evaluation per confound", async () => {
    const confoundId = `latest-evaluation-${crypto.randomUUID()}`;
    const dayStart = new Date("2096-06-15T00:00:00.000Z");
    const earlier = new Date(dayStart.getTime() + 10 * 60 * 60 * 1000);
    const latest = new Date(dayStart.getTime() + 11 * 60 * 60 * 1000);
    const ids = [crypto.randomUUID(), crypto.randomUUID()].sort();
    const lowerId = ids[0] as string;
    const higherId = ids[1] as string;

    await client.query(
      `insert into ashwini.confound_definitions
       (confound_id, label, domains, blocking, required_for_verdict, version, active)
       values ($1, 'Deterministic context test', '{system}', false, false, 'test', false)`,
      [confoundId],
    );

    await client.query(
      `insert into ashwini.confound_evaluations
       (eval_id, confound_id, subject_kind, evaluated_ts, state, detail)
       values
         (gen_random_uuid(), $1, 'window', $2, 'absent', 'Earlier evaluation'),
         ($3, $1, 'window', $4, 'present', 'Lower tie-breaker'),
         ($5, $1, 'window', $4, 'unknown', 'Higher tie-breaker')`,
      [confoundId, earlier, lowerId, latest, higherId],
    );

    const context = await buildSubjectContext(
      fixedClock(new Date(dayStart.getTime() + 12 * 60 * 60 * 1000).toISOString(), "UTC"),
    );
    const evaluations = context.confoundEvaluations.filter(
      (evaluation) => evaluation.confoundId === confoundId,
    );

    expect(evaluations).toEqual([
      {
        confoundId,
        state: "unknown",
        detail: "Higher tie-breaker",
      },
    ]);
  });

  it("returns a stored routine and no synthetic routines on Plan", async () => {
    const name = `Live routine ${crypto.randomUUID()}`;
    await client.query(
      `insert into ashwini.routines
       (name, domain, status, behavior, target, expected_lag)
       values ($1, 'nutrition', 'active', 'Use the saved behavior', 'Use the saved target', '7 days')`,
      [name],
    );

    const response = await planGET(new Request("http://ashwini.test/api/plan"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { routines: { name: string }[] };
    expect(body.routines.some((routine) => routine.name === name)).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/Protein fallback|Pre-training meal|House Dal/);
  });

  it("reports exact per-routine evidence beyond the former global row limits", async () => {
    const firstName = `High-volume routine ${crypto.randomUUID()}`;
    const secondName = `Independent routine ${crypto.randomUUID()}`;
    const inserted = await client.query<{ routine_id: string; name: string }>(
      `insert into ashwini.routines
       (name, domain, status, behavior, target, expected_lag)
       values
         ($1, 'nutrition', 'active', 'First behavior', 'First target', '7 days'),
         ($2, 'recovery', 'active', 'Second behavior', 'Second target', '7 days')
       returning routine_id, name`,
      [firstName, secondName],
    );
    const firstId = inserted.rows.find((row) => row.name === firstName)?.routine_id as string;
    const secondId = inserted.rows.find((row) => row.name === secondName)?.routine_id as string;

    await client.query(
      `insert into ashwini.routine_occurrences
       (routine_id, ts, performed, comparable, exclusion_reason)
       select $1, now() - (series * interval '1 minute'), true, true, null
       from generate_series(1, 501) as series`,
      [firstId],
    );
    await client.query(
      `insert into ashwini.routine_occurrences
       (routine_id, ts, performed, comparable, exclusion_reason)
       values ($1, now(), false, false, 'Saved exclusion')`,
      [secondId],
    );
    await client.query(
      `insert into ashwini.routine_reviews
       (routine_id, reviewed_ts, evidence_status, summary, refused)
       select $1, now() - (series * interval '1 minute'), 'recorded', 'First review', 'No claim'
       from generate_series(1, 101) as series`,
      [firstId],
    );
    await client.query(
      `insert into ashwini.routine_reviews
       (routine_id, reviewed_ts, evidence_status, summary, refused)
       values ($1, now(), 'recorded', 'Independent latest review', 'No claim')`,
      [secondId],
    );

    const response = await planGET(new Request("http://ashwini.test/api/plan"));
    const body = (await response.json()) as {
      routines: {
        id: string;
        progress: { total: number; comparable: number; excluded: number };
        latestOccurrence: { comparable: boolean } | null;
        latestReview: { summary: string } | null;
      }[];
      reviews: { routineId: string; summary: string }[];
    };
    const first = body.routines.find((routine) => routine.id === firstId);
    const second = body.routines.find((routine) => routine.id === secondId);

    expect(first?.progress).toMatchObject({ total: 501, comparable: 501, excluded: 0 });
    expect(second?.progress).toMatchObject({ total: 1, comparable: 0, excluded: 1 });
    expect(second?.latestOccurrence?.comparable).toBe(false);
    expect(second?.latestReview?.summary).toBe("Independent latest review");
    expect(body.reviews).toContainEqual({
      routineId: secondId,
      summary: "Independent latest review",
      id: expect.any(String),
      reviewedAt: expect.any(String),
      evidenceStatus: "recorded",
      withCount: 0,
      withoutCount: 0,
      excludedCount: 0,
      refused: "No claim",
      decisionId: null,
    });
  });

  it("serves exact stored choices and removes a decision after a durable response", async () => {
    const sourceText = `Decision source ${crypto.randomUUID()}`;
    const choices = ["First stored choice", "Second stored choice"];
    const source = await client.query<{ message_id: string }>(
      "insert into ashwini.messages (role, text, kind) values ('user', $1, 'record') returning message_id",
      [sourceText],
    );
    const advisor = await client.query<{ message_id: string }>(
      `insert into ashwini.messages
       (role, text, kind, receipt, in_reply_to, advisor_version, rule_id)
       values ('ashwini', 'Stored reply', 'recommendation', 'Stored receipt', $1, 'test-advisor', 'test-rule')
       returning message_id`,
      [source.rows[0]?.message_id],
    );
    const inserted = await client.query<{ decision_id: string }>(
      `insert into ashwini.decisions
       (type, domain, evidence_status, ladder_level, confidence_note,
        gate_outcome, gate_reason, choices, refused, advisor_version, rule_id, message_id)
       values ('recommendation', 'nutrition', 'recorded', 0, 'Stored confidence',
               'clear', 'Stored gate reason', $1::jsonb, 'No extra claim',
               'test-advisor', 'test-rule', $2)
       returning decision_id`,
      [JSON.stringify(choices), advisor.rows[0]?.message_id],
    );
    const decisionId = inserted.rows[0]?.decision_id as string;

    const before = await decisionsGET(new Request("http://ashwini.test/api/decisions"));
    const beforeBody = (await before.json()) as {
      decisions: { decisionId: string; sourceMessageId: string; choices: string[] }[];
    };
    const decision = beforeBody.decisions.find((item) => item.decisionId === decisionId);
    expect(decision?.sourceMessageId).toBe(source.rows[0]?.message_id);
    expect(decision?.choices).toEqual(choices);

    const choice = decision?.choices[0] as string;
    const written = await respondPOST(
      new Request(`http://ashwini.test/api/decisions/${decisionId}/respond`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ choice }),
      }),
      { params: Promise.resolve({ id: decisionId }) },
    );
    expect(written.status).toBe(201);

    const duplicate = await respondPOST(
      new Request(`http://ashwini.test/api/decisions/${decisionId}/respond`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ choice }),
      }),
      { params: Promise.resolve({ id: decisionId }) },
    );
    expect(duplicate.status).toBe(409);

    const after = await decisionsGET(new Request("http://ashwini.test/api/decisions"));
    const afterBody = (await after.json()) as { decisions: { decisionId: string }[] };
    expect(afterBody.decisions.some((item) => item.decisionId === decisionId)).toBe(false);
  });

  it("returns only decisions that have an action or acknowledgment", async () => {
    const recordOnlyId = await insertOpenDecision({ choices: [] });
    const choiceId = await insertOpenDecision({ choices: ["Stored choice"] });
    const routeId = await insertOpenDecision({
      choices: [],
      type: "route_out",
      route: "clinician",
    });
    const dataBlockId = await insertOpenDecision({ choices: [], type: "data_quality_block" });

    const response = await decisionsGET(new Request("http://ashwini.test/api/decisions"));
    const body = (await response.json()) as { decisions: { decisionId: string }[] };
    const returned = new Set(body.decisions.map((decision) => decision.decisionId));

    expect(returned.has(recordOnlyId)).toBe(false);
    expect(returned.has(choiceId)).toBe(true);
    expect(returned.has(routeId)).toBe(true);
    expect(returned.has(dataBlockId)).toBe(true);
  });

  it("acknowledges no-choice safety routes and data-quality blocks without resolving them", async () => {
    const decisionIds = [
      await insertOpenDecision({ choices: [], type: "route_out", route: "emergency" }),
      await insertOpenDecision({ choices: [], type: "data_quality_block" }),
    ];

    for (const decisionId of decisionIds) {
      const response = await respondPOST(
        new Request(`http://ashwini.test/api/decisions/${decisionId}/respond`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ acknowledge: true }),
        }),
        { params: Promise.resolve({ id: decisionId }) },
      );
      expect(response.status).toBe(201);

      const stored = await client.query<{
        choice: string;
        was_override: boolean;
        override_reason: string | null;
      }>(
        `select choice, was_override, override_reason
         from ashwini.decision_responses
         where decision_id = $1`,
        [decisionId],
      );
      expect(stored.rows).toEqual([
        { choice: "Acknowledged", was_override: false, override_reason: null },
      ]);

      const outcome = await client.query(
        "select outcome_id from ashwini.decision_outcomes where decision_id = $1",
        [decisionId],
      );
      expect(outcome.rowCount).toBe(0);
    }

    const open = await decisionsGET(new Request("http://ashwini.test/api/decisions"));
    const body = (await open.json()) as { decisions: { decisionId: string }[] };
    expect(body.decisions.some((decision) => decisionIds.includes(decision.decisionId))).toBe(
      false,
    );
  });

  it("rejects acknowledgment for ordinary record-only and choice decisions", async () => {
    const recordOnlyId = await insertOpenDecision({ choices: [] });
    const choiceId = await insertOpenDecision();
    const acknowledge = (decisionId: string) =>
      respondPOST(
        new Request(`http://ashwini.test/api/decisions/${decisionId}/respond`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ acknowledge: true }),
        }),
        { params: Promise.resolve({ id: decisionId }) },
      );

    const [recordOnly, choice] = await Promise.all([
      acknowledge(recordOnlyId),
      acknowledge(choiceId),
    ]);
    expect(recordOnly.status).toBe(400);
    expect(choice.status).toBe(400);

    const stored = await client.query(
      "select response_id from ashwini.decision_responses where decision_id = any($1::uuid[])",
      [[recordOnlyId, choiceId]],
    );
    expect(stored.rowCount).toBe(0);
  });

  it("serializes two answers to one immutable decision", async () => {
    const decisionId = await insertOpenDecision();
    const responses = await Promise.all([
      respondPOST(responseRequest(decisionId), {
        params: Promise.resolve({ id: decisionId }),
      }),
      respondPOST(responseRequest(decisionId), {
        params: Promise.resolve({ id: decisionId }),
      }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
  });

  it("rejects an arbitrary response when no choices were offered", async () => {
    const decisionId = await insertOpenDecision({ choices: [] });
    const response = await respondPOST(responseRequest(decisionId, "invented choice"), {
      params: Promise.resolve({ id: decisionId }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects responses to expired and corrected decisions", async () => {
    const expiredId = await insertOpenDecision({ expiresAt: new Date(Date.now() - 60_000) });
    const correctedId = await insertOpenDecision({ corrected: true });
    const [expired, corrected] = await Promise.all([
      respondPOST(responseRequest(expiredId), {
        params: Promise.resolve({ id: expiredId }),
      }),
      respondPOST(responseRequest(correctedId), {
        params: Promise.resolve({ id: correctedId }),
      }),
    ]);
    expect(expired.status).toBe(409);
    expect(corrected.status).toBe(409);
  });

  it("does not leave a corrected check-in's decision open", async () => {
    const original = await handleUtterance({ text: "my shoulder hurts under load" });
    const originalDecisionId = original.decisionIds[0] as string;
    await handleUtterance({
      text: "Correction: it was ordinary post-training soreness, not pain",
      correctionOf: original.userMessageId,
    });

    const response = await decisionsGET(new Request("http://ashwini.test/api/decisions"));
    const body = (await response.json()) as { decisions: { decisionId: string }[] };
    expect(body.decisions.some((item) => item.decisionId === originalDecisionId)).toBe(false);
  });
});

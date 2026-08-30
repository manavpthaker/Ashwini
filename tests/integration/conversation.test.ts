import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

/**
 * The conversation round trip, against a real database.
 *
 * This is the path the interface now depends on: a check-in is classified,
 * persisted, and read back. The properties worth proving here are the ones no
 * unit test can — that a correction supersedes without erasing (PRD 4.4), that
 * the append-only trigger permits exactly that one mutation, and that a safety
 * route-out survives the round trip so a reload cannot lose a block.
 */

const connectionString = process.env.ASHWINI_TEST_DATABASE_URL;
const describeIfDb = connectionString ? describe : describe.skip;

describeIfDb("conversation round trip", () => {
  let client: Client;
  let handleUtterance: typeof import("@/server/advisor-service").handleUtterance;
  let closeDb: typeof import("@/server/db/client").closeDb;

  beforeAll(async () => {
    (process.env as Record<string, string | undefined>).DATABASE_URL = connectionString;
    (process.env as Record<string, string | undefined>).ASHWINI_TIME_ZONE = "UTC";

    ({ handleUtterance } = await import("@/server/advisor-service"));
    ({ closeDb } = await import("@/server/db/client"));

    client = new Client({ connectionString });
    await client.connect();
  });

  afterAll(async () => {
    await closeDb?.();
    await client?.end();
  });

  it("writes the user message, the reply, and one decision", async () => {
    const result = await handleUtterance({ text: "I ate lunch" });

    expect(result.replayed).toBe(false);
    expect(result.decisionIds).toHaveLength(1);

    const { rows } = await client.query<{ role: string; in_reply_to: string | null }>(
      "select role, in_reply_to from ashwini.messages where message_id = any($1)",
      [[result.userMessageId, result.advisorMessageId]],
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.role === "ashwini")?.in_reply_to).toBe(result.userMessageId);
  });

  it("routes a skin lesion to a dermatologist and documents it without analysing it", async () => {
    // PRD 11.4. The regression this pins: "back" used to match the
    // musculoskeletal rule first and return training advice.
    const result = await handleUtterance({ text: "the mole on my back looks different" });

    expect(result.output.route).toBe("dermatologist");
    expect(result.output.decisions[0]?.evidenceStatus).toBe("route_out");

    const { rows } = await client.query<{ user_wording: string }>(
      "select user_wording from ashwini.dermatology_handoffs where message_id = $1",
      [result.userMessageId],
    );
    expect(rows[0]?.user_wording).toBe("the mole on my back looks different");
  });

  it("points a corrected message forward and keeps the original", async () => {
    const original = await handleUtterance({ text: "my shoulder hurts under load" });
    const correction = await handleUtterance({
      text: "Correction: it was sore, not painful",
      correctionOf: original.userMessageId,
    });

    const { rows } = await client.query<{
      message_id: string;
      text: string;
      corrected_by: string | null;
    }>("select message_id, text, corrected_by from ashwini.messages where message_id = any($1)", [
      [original.userMessageId, correction.userMessageId],
    ]);

    const before = rows.find((row) => row.message_id === original.userMessageId);
    expect(before?.corrected_by).toBe(correction.userMessageId);
    // Retained, not rewritten: the original wording is still the original.
    expect(before?.text).toBe("my shoulder hurts under load");
  });

  it("refuses a correction that names a message which does not exist", async () => {
    await expect(
      handleUtterance({
        text: "Correction: never mind",
        correctionOf: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow(/missing or has already been superseded/i);
  });

  it("does not let a stale correction repoint an already-corrected message", async () => {
    const original = await handleUtterance({ text: "my shoulder hurts under load" });
    const first = await handleUtterance({
      text: "Correction: it was ordinary soreness",
      correctionOf: original.userMessageId,
    });

    await expect(
      handleUtterance({
        text: "Correction: stale replacement",
        correctionOf: original.userMessageId,
      }),
    ).rejects.toThrow(/missing or has already been superseded/i);

    const source = await client.query<{ corrected_by: string | null }>(
      "select corrected_by from ashwini.messages where message_id = $1",
      [original.userMessageId],
    );
    expect(source.rows[0]?.corrected_by).toBe(first.userMessageId);
  });

  it("permits no mutation of a message other than corrected_by", async () => {
    const { userMessageId } = await handleUtterance({ text: "took my morning meds" });

    await expect(
      client.query("update ashwini.messages set text = 'rewritten' where message_id = $1", [
        userMessageId,
      ]),
    ).rejects.toThrow();

    await expect(
      client.query("delete from ashwini.messages where message_id = $1", [userMessageId]),
    ).rejects.toThrow();
  });

  it("routes a drug–drug question even when the drugs are not on file", async () => {
    // PRD 11.7 is unconditional. This database holds no medication list, which
    // is exactly the state a new user is in when they first ask.
    const result = await handleUtterance({
      text: "can i take lisinopril with ibuprofen",
    });

    expect(result.output.trace.ruleId).toBe("drug-drug");
    expect(result.output.route).toBe("pharmacist");
    expect(result.output.decisions[0]?.evidenceStatus).toBe("route_out");
    // A question is not an adherence event. Persist only the route fact so a
    // reload retains the safety boundary without inventing medication use.
    expect(result.output.records[0]?.kind).toBe("context_note");
  });

  it("records every kind it reports, including the ones with no table", async () => {
    // The response listed "medication event recorded" and the reload did not,
    // because a kind with no dedicated table wrote no routed_records row. What
    // Ashwini says it recorded has to still be there after a refresh.
    const result = await handleUtterance({ text: "can i take lisinopril with ibuprofen" });
    expect(result.output.records.map((record) => record.kind)).toEqual(["context_note"]);

    const { rows } = await client.query<{ record_kind: string; record_table: string }>(
      "select record_kind, record_table from ashwini.routed_records where message_id = $1",
      [result.userMessageId],
    );
    expect(rows).toEqual([{ record_kind: "context_note", record_table: "messages" }]);
  });

  it("discards therapy content before it reaches the message table", async () => {
    const privateToken = `therapy-private-${crypto.randomUUID()}`;
    const result = await handleUtterance({
      text: `My therapy session covered ${privateToken}`,
    });

    const { rows } = await client.query<{ text: string }>(
      "select text from ashwini.messages where message_id = $1",
      [result.userMessageId],
    );
    expect(rows[0]?.text).toBe("Therapy session mentioned · content not retained");
    const leaked = await client.query<{ count: string }>(
      "select count(*) from ashwini.messages where text like $1",
      [`%${privateToken}%`],
    );
    expect(leaked.rows[0]?.count).toBe("0");
  });

  it("discards crisis content before it reaches the message table", async () => {
    const privateToken = `crisis-private-${crypto.randomUUID()}`;
    const result = await handleUtterance({
      text: `I want to end my life because ${privateToken}`,
    });

    const { rows } = await client.query<{ text: string }>(
      "select text from ashwini.messages where message_id = $1",
      [result.userMessageId],
    );
    expect(rows[0]?.text).toBe("Crisis check-in received · content not retained");
    const leaked = await client.query<{ count: string }>(
      "select count(*) from ashwini.messages where text like $1",
      [`%${privateToken}%`],
    );
    expect(leaked.rows[0]?.count).toBe("0");
  });

  it("routes a mixed therapy and urgent symptom without retaining its wording", async () => {
    const privateToken = `mixed-private-${crypto.randomUUID()}`;
    const result = await handleUtterance({
      text: `I just left therapy and now I have chest pain ${privateToken}`,
    });

    expect(result.output.trace.ruleId).toBe("urgent-symptoms");
    expect(result.output.route).toBe("emergency");
    expect(result.userText).toBe("Therapy session mentioned · content not retained");

    const message = await client.query<{ text: string }>(
      "select text from ashwini.messages where message_id = $1",
      [result.userMessageId],
    );
    expect(message.rows[0]?.text).toBe("Therapy session mentioned · content not retained");
    const symptom = await client.query<{ count: string }>(
      "select count(*)::text as count from ashwini.symptoms where message_id = $1",
      [result.userMessageId],
    );
    expect(symptom.rows[0]?.count).toBe("0");
    expect(JSON.stringify(message.rows)).not.toContain(privateToken);
  });

  it("treats the same idempotency key as one write", async () => {
    const key = `test-${crypto.randomUUID()}`;
    const first = await handleUtterance({ text: "I feel flat today", idempotencyKey: key });
    const second = await handleUtterance({ text: "I feel flat today", idempotencyKey: key });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.advisorMessageId).toBe(first.advisorMessageId);
    expect(second.decisionIds).toEqual(first.decisionIds);
    expect(second.output).toEqual(first.output);

    const { rows } = await client.query<{ count: string }>(
      "select count(*) from ashwini.messages where idempotency_key = $1",
      [key],
    );
    expect(rows[0]?.count).toBe("1");
  });

  it("rejects reuse of an idempotency key for different wording", async () => {
    const key = `test-${crypto.randomUUID()}`;
    await handleUtterance({ text: "I feel flat today", idempotencyKey: key });
    await expect(handleUtterance({ text: "I ate lunch", idempotencyKey: key })).rejects.toThrow(
      /already used for a different check-in/i,
    );
  });

  it("binds a protected replay to the exact sensitive input", async () => {
    const key = `test-${crypto.randomUUID()}`;
    const first = await handleUtterance({
      text: "My therapy session was about work",
      idempotencyKey: key,
    });
    const replay = await handleUtterance({
      text: "My therapy session was about work",
      idempotencyKey: key,
    });

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    await expect(
      handleUtterance({
        text: "I just left therapy and now I have chest pain",
        idempotencyKey: key,
      }),
    ).rejects.toThrow(/already used for a different check-in/i);
  });

  it("turns concurrent first writes with one key into one write and one replay", async () => {
    const key = `test-${crypto.randomUUID()}`;
    const results = await Promise.all([
      handleUtterance({ text: "I feel flat today", idempotencyKey: key }),
      handleUtterance({ text: "I feel flat today", idempotencyKey: key }),
    ]);

    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect(results[0]?.userMessageId).toBe(results[1]?.userMessageId);
    expect(results[0]?.advisorMessageId).toBe(results[1]?.advisorMessageId);
  });
});

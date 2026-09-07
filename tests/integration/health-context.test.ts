import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { parseHealthContextImport, type HealthContextImport } from "@/lib/health-context";
import { applyHealthContextImport } from "@/lib/health-context-import";
import { SENSITIVE_REDACTION } from "@/domain/advisor";

const connectionString = process.env.ASHWINI_TEST_DATABASE_URL;
const describeIfDb = connectionString ? describe : describe.skip;

function syntheticImport(): HealthContextImport {
  return parseHealthContextImport({
    version: 1,
    containsTherapyNarrative: false,
    sources: [
      {
        key: `synthetic-${crypto.randomUUID()}`,
        label: "Synthetic source",
        locator: "synthetic.md",
        contentHash: "a".repeat(64),
        sourceDate: "2025-01-01",
        datePrecision: "year",
        entries: [
          {
            key: "goal",
            category: "goal",
            statement: "The synthetic owner preferred familiar walking routes.",
            sourceLocator: "synthetic.md#goals",
            sourceDate: "2025-01-01",
            datePrecision: "year",
            temporalStatus: "historical",
            confirmationRequired: true,
          },
        ],
      },
    ],
  });
}

describeIfDb("private longitudinal context", () => {
  let client: Client;
  let buildContext: typeof import("@/server/context").buildSubjectContext;
  let closeDb: typeof import("@/server/db/client").closeDb;

  beforeAll(async () => {
    process.env.DATABASE_URL = connectionString;
    process.env.ASHWINI_TIME_ZONE = "UTC";
    ({ buildSubjectContext: buildContext } = await import("@/server/context"));
    ({ closeDb } = await import("@/server/db/client"));
    client = new Client({ connectionString });
    await client.connect();
  });

  afterAll(async () => {
    await closeDb?.();
    await client?.end();
  });

  const clock = { now: () => new Date("2099-06-01T12:00:00Z"), timeZone: () => "UTC" };

  it("imports once, hydrates source-backed history and never writes active prescriptions", async () => {
    const payload = syntheticImport();
    const before = await client.query("select count(*)::int as n from ashwini.medications");
    expect(await applyHealthContextImport(client, payload)).toEqual({
      sourcesInserted: 1,
      sourcesUnchanged: 0,
      entriesInserted: 1,
    });
    expect(await applyHealthContextImport(client, payload)).toEqual({
      sourcesInserted: 0,
      sourcesUnchanged: 1,
      entriesInserted: 0,
    });
    const context = await buildContext(clock);
    const entry = context.healthHistory?.find(
      (item) =>
        item.sourceLabel === "Synthetic source" &&
        item.statement === payload.sources[0]!.entries[0]!.statement,
    );
    expect(entry).toMatchObject({
      sourceDate: "2025-01-01",
      sourceDatePrecision: "year",
      temporalStatus: "historical",
      confirmationRequired: true,
    });
    const after = await client.query("select count(*)::int as n from ashwini.medications");
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("retains old assertions but retrieves only the latest explicit source revision", async () => {
    const payload = syntheticImport();
    payload.sources[0]!.entries[0]!.statement = `Old synthetic assertion ${crypto.randomUUID()}`;
    await applyHealthContextImport(client, payload);
    const revised = structuredClone(payload);
    revised.sources[0]!.revision = 2;
    revised.sources[0]!.entries[0]!.statement = `Revised synthetic assertion ${crypto.randomUUID()}`;
    await applyHealthContextImport(client, revised);
    await applyHealthContextImport(client, payload);
    const context = await buildContext(clock);
    expect(
      context.healthHistory?.some(
        (entry) => entry.statement === payload.sources[0]!.entries[0]!.statement,
      ),
    ).toBe(false);
    expect(
      context.healthHistory?.some(
        (entry) => entry.statement === revised.sources[0]!.entries[0]!.statement,
      ),
    ).toBe(true);
    const rows = await client.query(
      `select entry.context_id from ashwini.health_context_entries entry join ashwini.health_context_sources source using(source_id) where source.source_key = $1`,
      [payload.sources[0]!.key],
    );
    expect(rows.rows).toHaveLength(2);
    await expect(
      client.query(
        "update ashwini.health_context_entries set statement = 'rewritten' where context_id = $1",
        [rows.rows[0].context_id],
      ),
    ).rejects.toThrow(/append-only/);
  });

  it("rolls back the entire import on a divergent replay", async () => {
    const payload = syntheticImport();
    await applyHealthContextImport(client, payload);
    const fresh = syntheticImport();
    const conflict = structuredClone(payload.sources[0]!);
    conflict.entries[0]!.statement = "A divergent assertion without an explicit revision.";
    fresh.sources.push(conflict);
    await expect(applyHealthContextImport(client, fresh)).rejects.toThrow(/different curated/);
    const result = await client.query(
      "select count(*)::int as n from ashwini.health_context_sources where source_key = $1",
      [fresh.sources[0]!.key],
    );
    expect(result.rows[0].n).toBe(0);
  });

  it("excludes protected and superseded check-ins before the history limit and loads active routines", async () => {
    const marker = `Synthetic context ${crypto.randomUUID()}`;
    const valid = await client.query<{ message_id: string }>(
      "insert into ashwini.messages (role, text, ts) values ('user', $1, '2099-06-01T10:00:00Z') returning message_id",
      [marker],
    );
    await client.query(
      "insert into ashwini.messages (role, text, ts) select 'user', $1, '2099-06-01T11:00:00Z' from generate_series(1, 25)",
      [SENSITIVE_REDACTION["therapy-content"]],
    );
    const old = await client.query<{ message_id: string }>(
      "insert into ashwini.messages (role, text, ts) values ('user', $1, '2099-06-01T10:30:00Z') returning message_id",
      [`Superseded ${marker}`],
    );
    await client.query("update ashwini.messages set corrected_by = $1 where message_id = $2", [
      valid.rows[0]!.message_id,
      old.rows[0]!.message_id,
    ]);
    const routine = await client.query<{ routine_id: string }>(
      "insert into ashwini.routines (name, domain, status, behavior, target, expected_lag) values ($1, 'training', 'active', 'walk', 'routine', 'weeks') returning routine_id",
      [marker],
    );
    const context = await buildContext(clock);
    expect(context.recentCheckins?.some((item) => item.text === marker)).toBe(true);
    expect(context.recentCheckins?.some((item) => item.text === `Superseded ${marker}`)).toBe(
      false,
    );
    expect(
      context.recentCheckins?.some((item) =>
        Object.values(SENSITIVE_REDACTION).includes(item.text),
      ),
    ).toBe(false);
    expect(context.activeRoutines.some((item) => item.id === routine.rows[0]!.routine_id)).toBe(
      true,
    );
  });

  it("enables deny-by-default RLS for both history tables", async () => {
    const result = await client.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "select relrowsecurity, relforcerowsecurity from pg_class where oid in ('ashwini.health_context_sources'::regclass, 'ashwini.health_context_entries'::regclass)",
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((row) => row.relrowsecurity && !row.relforcerowsecurity)).toBe(true);
  });

  it("keeps bibliography out of authorized medication-interaction results", async () => {
    await client.query(
      "insert into ashwini.external_results (provider, items, response) values ('Europe PMC', '{}', '{\"data\":[]}')",
    );
    const context = await buildContext(clock);
    expect(
      context.interactionResults.every((result) => result.provider === "Examine Connect"),
    ).toBe(true);
  });

  it("uses capture time for delayed check-ins and keeps receipt time separately", async () => {
    const marker = `Synthetic delayed report ${crypto.randomUUID()}`;
    await client.query(
      `insert into ashwini.messages (role, text, ts, captured_at)
       values ('user', $1, '2099-06-01T11:59:00Z', '2099-05-30T08:00:00Z'),
              ('user', $2, '2099-06-01T11:59:00Z', '2099-06-02T08:00:00Z')`,
      [marker, `Future ${marker}`],
    );
    const context = await buildContext(clock);
    const delayed = context.recentCheckins?.find((item) => item.text === marker);
    expect(delayed?.at.toISOString()).toBe("2099-05-30T08:00:00.000Z");
    expect(delayed?.receivedAt?.toISOString()).toBe("2099-06-01T11:59:00.000Z");
    expect(context.recentCheckins?.some((item) => item.text === `Future ${marker}`)).toBe(false);
  });

  it("keeps sparse wearable types visible, separates devices and excludes future readings", async () => {
    const marker = crypto.randomUUID();
    const batch = await client.query<{ import_id: string }>(
      "insert into ashwini.health_import_batches (format, fingerprint, report) values ('apple-health-xml-v1', repeat(md5($1),2), '{}') returning import_id",
      [marker],
    );
    const importId = batch.rows[0]!.import_id;
    await client.query(
      `insert into ashwini.health_observations
       (identity, first_import_id, kind, type, value, unit, source_name, device, start_at, end_at, original_start_at, original_end_at)
       select repeat(md5($1 || i::text), 2), $2, 'record', 'HKQuantityTypeIdentifierHeartRate', '65', 'count/min', $1, 'watch',
         '2099-06-01T11:00:00Z'::timestamptz, '2099-06-01T11:00:00Z'::timestamptz, '2099-06-01T11:00:00Z', '2099-06-01T11:00:00Z'
       from generate_series(1, 100) i`,
      [marker, importId],
    );
    for (const [suffix, device, date] of [
      ["weight", "scale", "2099-05-01T11:00:00Z"],
      ["other-weight", "other-scale", "2099-05-01T11:00:00Z"],
      ["future", "future-scale", "2099-06-02T11:00:00Z"],
    ]) {
      await client.query(
        `insert into ashwini.health_observations
         (identity, first_import_id, kind, type, value, unit, source_name, device, start_at, end_at, original_start_at, original_end_at)
         values (repeat(md5($1),2), $2, 'record', 'HKQuantityTypeIdentifierBodyMass', '70', 'kg', $3, $4, $5::timestamptz, $5::timestamptz, $5::text, $5::text)`,
        [`${marker}-${suffix}`, importId, marker, device, date],
      );
    }
    const context = await buildContext(clock);
    const readings = context.healthObservations?.filter((item) => item.sourceName === marker);
    expect(readings).toHaveLength(3);
    expect(
      readings?.filter((item) => item.type === "HKQuantityTypeIdentifierBodyMass"),
    ).toHaveLength(2);
    expect(
      readings?.every((item) => item.samplesInInput === 1 && item.device !== "future-scale"),
    ).toBe(true);
  });

  it("loads the advisor question paired with an eligible user turn, never a superseded turn", async () => {
    const marker = `Synthetic follow-up ${crypto.randomUUID()}`;
    const user = await client.query<{ message_id: string }>(
      "insert into ashwini.messages (role, text, ts) values ('user', $1, '2099-06-01T11:58:00Z') returning message_id",
      [marker],
    );
    const reply = await client.query<{ message_id: string }>(
      "insert into ashwini.messages (role, text, ts, in_reply_to) values ('ashwini', 'How long until your workout?', '2099-06-01T11:58:01Z', $1) returning message_id",
      [user.rows[0]!.message_id],
    );
    const context = await buildContext(clock, { includeWearables: false });
    expect(
      context.recentCheckins?.find((turn) => turn.id === user.rows[0]!.message_id),
    ).toMatchObject({
      text: marker,
      advisorReply: "How long until your workout?",
      advisorMessageId: reply.rows[0]!.message_id,
    });
    expect(context.healthObservations).toBeUndefined();
    const replacement = await client.query<{ message_id: string }>(
      "insert into ashwini.messages (role, text, ts) values ('user', $1, '2099-06-01T11:59:00Z') returning message_id",
      [`Corrected ${marker}`],
    );
    await client.query("update ashwini.messages set corrected_by = $1 where message_id = $2", [
      replacement.rows[0]!.message_id,
      user.rows[0]!.message_id,
    ]);
    const corrected = await buildContext(clock, { includeWearables: false });
    expect(corrected.recentCheckins?.some((turn) => turn.id === user.rows[0]!.message_id)).toBe(
      false,
    );
    expect(
      corrected.recentCheckins?.some((turn) => turn.advisorMessageId === reply.rows[0]!.message_id),
    ).toBe(false);
  });

  it("retains the latest received delayed exchange even behind more than twenty newer event dates", async () => {
    const marker = `Synthetic delayed continuity ${crypto.randomUUID()}`;
    await client.query(
      `insert into ashwini.messages (role, text, ts, captured_at)
       select 'user', $1 || i::text,
         '2100-06-01T10:00:00Z'::timestamptz + i * interval '1 minute',
         '2100-06-01T10:00:00Z'::timestamptz + i * interval '1 minute'
       from generate_series(1, 25) i`,
      [`Newer event ${marker} `],
    );
    const delayed = await client.query<{ message_id: string }>(
      `insert into ashwini.messages (role, text, ts, captured_at)
       values ('user', $1, '2100-06-01T11:59:00Z', '2100-05-01T10:00:00Z') returning message_id`,
      [marker],
    );
    await client.query(
      `insert into ashwini.messages (role, text, ts, in_reply_to)
       values ('ashwini', 'How long until your workout?', '2100-06-01T11:59:01Z', $1)`,
      [delayed.rows[0]!.message_id],
    );
    const context = await buildContext(
      { now: () => new Date("2100-06-01T12:00:00Z"), timeZone: () => "UTC" },
      { includeWearables: false },
    );
    expect(context.recentCheckins).toHaveLength(20);
    expect(context.recentCheckins?.[0]).toMatchObject({
      id: delayed.rows[0]!.message_id,
      text: marker,
      at: new Date("2100-05-01T10:00:00Z"),
      receivedAt: new Date("2100-06-01T11:59:00Z"),
      advisorReply: "How long until your workout?",
      advisorAt: new Date("2100-06-01T11:59:01Z"),
    });
    expect(context.latestReceiptTurn).toEqual({
      id: delayed.rows[0]!.message_id,
      receivedAt: new Date("2100-06-01T11:59:00Z"),
      eligible: true,
    });
    expect(
      context.recentCheckins?.every(
        (turn, index, turns) =>
          index === 0 || turns[index - 1]!.receivedAt!.getTime() >= turn.receivedAt!.getTime(),
      ),
    ).toBe(true);
  });

  it("retains only a content-free barrier when the newest received turn is protected", async () => {
    const marker = `Synthetic barrier ${crypto.randomUUID()}`;
    await client.query(
      "insert into ashwini.messages (role, text, ts) values ('user', $1, '2110-06-01T11:58:00Z')",
      [marker],
    );
    const protectedTurn = await client.query<{ message_id: string }>(
      "insert into ashwini.messages (role, text, ts) values ('user', $1, '2110-06-01T11:59:00Z') returning message_id",
      [SENSITIVE_REDACTION["therapy-content"]],
    );
    const context = await buildContext(
      { now: () => new Date("2110-06-01T12:00:00Z"), timeZone: () => "UTC" },
      { includeWearables: false },
    );
    expect(context.latestReceiptTurn).toEqual({
      id: protectedTurn.rows[0]!.message_id,
      receivedAt: new Date("2110-06-01T11:59:00Z"),
      eligible: false,
    });
    expect(
      context.recentCheckins?.some((turn) => turn.id === protectedTurn.rows[0]!.message_id),
    ).toBe(false);
    expect(JSON.stringify(context)).not.toContain(SENSITIVE_REDACTION["therapy-content"]);
  });
});

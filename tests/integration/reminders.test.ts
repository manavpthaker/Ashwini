import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

/**
 * The reminder scheduler, end to end against a real database.
 *
 * The property that matters most here is idempotency: a scheduler that runs
 * twice must not remind twice. That is enforced by a unique constraint rather
 * than by application care, and this is where that gets proven.
 */

const connectionString = process.env.ASHWINI_TEST_DATABASE_URL;
const describeIfDb = connectionString ? describe : describe.skip;

describeIfDb("reminder scheduler", () => {
  let client: Client;
  let runReminders: typeof import("@/server/reminders/run").runReminders;
  let closeDb: typeof import("@/server/db/client").closeDb;

  beforeAll(async () => {
    // server/db/client.ts reads DATABASE_URL through env(); point it at the
    // throwaway database before anything imports it.
    (process.env as Record<string, string | undefined>).DATABASE_URL = connectionString;
    (process.env as Record<string, string | undefined>).ASHWINI_TIME_ZONE = "UTC";

    ({ runReminders } = await import("@/server/reminders/run"));
    ({ closeDb } = await import("@/server/db/client"));

    client = new Client({ connectionString });
    await client.connect();

    await client.query(
      `insert into ashwini.medications (name, dose, unit, started_at)
       values ('reminder-test-med', 50, 'mg', '2026-01-01')`,
    );
  });

  afterAll(async () => {
    await closeDb?.();
    await client?.end();
  });

  async function addDose(offsetMinutes: number, extra = ""): Promise<string> {
    const { rows } = await client.query<{ dose_id: string }>(
      `insert into ashwini.doses (med_id, scheduled_ts ${extra ? `, ${extra.split("=")[0]}` : ""})
       select med_id, now() + interval '${offsetMinutes} minutes' ${extra ? `, ${extra.split("=")[1]}` : ""}
       from ashwini.medications where name = 'reminder-test-med'
       returning dose_id`,
    );
    return rows[0]?.dose_id as string;
  }

  it("reminds about a due dose, and never twice", async () => {
    const doseId = await addDose(5);

    const first = await runReminders(new Date());
    expect(first.considered).toBeGreaterThanOrEqual(1);

    // The unique (dose_id, scheduled_for) constraint is the idempotency point.
    const second = await runReminders(new Date());
    expect(second.considered).toBe(0);

    const { rows } = await client.query<{ count: string }>(
      "select count(*)::text as count from ashwini.reminder_dispatches where dose_id = $1",
      [doseId],
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it("records an undelivered reminder as failed rather than silently sent", async () => {
    // No channel is configured in tests, so the logging dispatcher is used. It
    // reports failure on purpose: a delivery that did not happen must not be
    // recorded as one.
    const { rows } = await client.query<{ status: string; channel: string; detail: string }>(
      "select status, channel, detail from ashwini.reminder_dispatches limit 1",
    );
    expect(rows[0]?.channel).toBe("log");
    expect(rows[0]?.status).toBe("failed");
    expect(rows[0]?.detail).toMatch(/No delivery channel/);
  });

  it("ignores a dose already taken", async () => {
    await addDose(6, "taken_ts=now()");
    const before = await countDispatches();
    await runReminders(new Date());
    expect(await countDispatches()).toBe(before);
  });

  it("ignores a dose deliberately skipped", async () => {
    await addDose(7, "skipped=true");
    const before = await countDispatches();
    await runReminders(new Date());
    expect(await countDispatches()).toBe(before);
  });

  it("ignores a dose outside the window", async () => {
    await addDose(600);
    const before = await countDispatches();
    await runReminders(new Date());
    expect(await countDispatches()).toBe(before);
  });

  it("keeps the dispatch log append-only", async () => {
    await expect(
      client.query("update ashwini.reminder_dispatches set status = 'sent'"),
    ).rejects.toThrow(/append-only/);
    await expect(client.query("delete from ashwini.reminder_dispatches")).rejects.toThrow(
      /append-only/,
    );
  });

  async function countDispatches(): Promise<number> {
    const { rows } = await client.query<{ count: string }>(
      "select count(*)::text as count from ashwini.reminder_dispatches",
    );
    return Number(rows[0]?.count);
  }
});

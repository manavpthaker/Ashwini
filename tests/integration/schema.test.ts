/**
 * Schema invariants, checked against a real Postgres.
 *
 * These are the PRD rules the database enforces itself, which is the point:
 * a constraint holds against a hand-written psql session at 1am, and a
 * convention does not.
 *
 * Runs only when ASHWINI_TEST_DATABASE_URL points at a throwaway database.
 * CI provides one; locally, see README. It never runs against Supabase.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const connectionString = process.env.ASHWINI_TEST_DATABASE_URL;
const describeIfDb = connectionString ? describe : describe.skip;

describeIfDb("schema invariants", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
  });

  async function failsWith(sql: string, pattern: RegExp): Promise<void> {
    await expect(client.query(sql)).rejects.toThrow(pattern);
  }

  const validDecision = `
    insert into ashwini.decisions
      (type, domain, evidence_status, ladder_level, confidence_note,
       gate_outcome, gate_reason, refused, advisor_version, rule_id)
    values ('recommendation','training',$STATUS$,$LEVEL$,'note',$GATE$,'reason','nothing','rules-1.0.0','r')
  `;

  const decision = (status: string, level: number, gate: string): string =>
    validDecision
      .replace("$STATUS$", `'${status}'`)
      .replace("$LEVEL$", String(level))
      .replace("$GATE$", `'${gate}'`);

  describe("PRD 11.5 — no verdict from a blocked window", () => {
    it("refuses a pattern verdict on a blocked window", async () => {
      await failsWith(
        decision("consistent_pattern", 4, "blocked"),
        /blocked_windows_issue_no_verdict/,
      );
    });

    it("refuses a plain recommendation on a blocked window", async () => {
      await failsWith(decision("rule_based", 2, "blocked"), /blocked_windows_issue_no_verdict/);
    });

    it("allows an unusable label on a blocked window", async () => {
      await expect(client.query(decision("unusable", 1, "blocked"))).resolves.toBeDefined();
    });

    it("allows a route-out on a blocked window", async () => {
      await expect(client.query(decision("route_out", 5, "blocked"))).resolves.toBeDefined();
    });
  });

  describe("PRD 5 — level 4 needs a clean window", () => {
    it("refuses level 4 on a caveated window", async () => {
      await failsWith(
        decision("consistent_pattern", 4, "caveated"),
        /level_four_requires_clear_gate/,
      );
    });

    it("allows level 4 on a clear window", async () => {
      await expect(client.query(decision("consistent_pattern", 4, "clear"))).resolves.toBeDefined();
    });

    it("refuses a ladder level outside 0-5", async () => {
      await failsWith(decision("recorded", 9, "clear"), /ladder_level/);
    });
  });

  describe("PRD 11.6 — prescriptions are never experiment variables", () => {
    it("refuses a manipulable medication", async () => {
      await failsWith(
        `insert into ashwini.medications (name, dose, unit, started_at, manipulable)
         values ('test-med', 1, 'mg', '2026-01-01', true)`,
        /prescribed_meds_are_not_experiments/,
      );
    });

    it("refuses a routine that names a prescription as its variable", async () => {
      await failsWith(
        `insert into ashwini.routines (name, domain, behavior, target, expected_lag, is_medication_variable)
         values ('bad', 'medication', 'b', 't', 'l', true)`,
        /prescriptions_are_never_routine_variables/,
      );
    });
  });

  describe("PRD 7.2 — meal estimates are ranges, structurally", () => {
    it("has no scalar calorie or protein column", async () => {
      const { rows } = await client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema = 'ashwini' and table_name = 'meals'`,
      );
      const names = rows.map((row) => row.column_name);
      expect(names).not.toContain("kcal");
      expect(names).not.toContain("calories");
      expect(names).not.toContain("protein");
      expect(names).toEqual(expect.arrayContaining(["kcal_low", "kcal_high"]));
    });

    it("refuses an inverted range", async () => {
      await failsWith(
        `insert into ashwini.meals (ts, source, confidence, kcal_low, kcal_high)
         values (now(), 'photo', 'low', 900, 400)`,
        /check constraint/,
      );
    });
  });

  describe("PRD 11.9 — therapy content is not stored", () => {
    it("has no column that could hold transcript text", async () => {
      const { rows } = await client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema = 'ashwini' and table_name = 'therapy_mentions'`,
      );
      const names = rows.map((row) => row.column_name);
      for (const forbidden of ["text", "content", "transcript", "note", "body"]) {
        expect(names).not.toContain(forbidden);
      }
    });
  });

  describe("PRD 8 / 9 — history is append-only", () => {
    it("refuses to update a decision", async () => {
      await client.query(decision("recorded", 0, "clear"));
      await failsWith("update ashwini.decisions set refused = 'changed'", /append-only/);
    });

    it("refuses to delete a decision", async () => {
      await failsWith("delete from ashwini.decisions", /append-only/);
    });

    it("refuses to delete a message", async () => {
      await client.query("insert into ashwini.messages (role, text) values ('user', 'x')");
      await failsWith("delete from ashwini.messages", /append-only/);
    });

    it("allows a correction to set the forward pointer", async () => {
      const original = await client.query<{ message_id: string }>(
        "insert into ashwini.messages (role, text) values ('user', 'original') returning message_id",
      );
      const replacement = await client.query<{ message_id: string }>(
        "insert into ashwini.messages (role, text) values ('user', 'corrected') returning message_id",
      );
      await expect(
        client.query("update ashwini.messages set corrected_by = $1 where message_id = $2", [
          replacement.rows[0]?.message_id,
          original.rows[0]?.message_id,
        ]),
      ).resolves.toBeDefined();
    });

    it("refuses to rewrite the text of a message", async () => {
      const inserted = await client.query<{ message_id: string }>(
        "insert into ashwini.messages (role, text) values ('user', 'keep me') returning message_id",
      );
      await expect(
        client.query("update ashwini.messages set text = 'rewritten' where message_id = $1", [
          inserted.rows[0]?.message_id,
        ]),
      ).rejects.toThrow(/append-only except for corrected_by/);
    });

    it("refuses to alter a recorded response after the fact", async () => {
      // PRD 8: an override is "permanently retained with the output it affected",
      // which only means something if the retained row cannot later be edited.
      const inserted = await client.query<{ decision_id: string }>(
        `${decision("recorded", 0, "clear")} returning decision_id`,
      );
      await client.query(
        `insert into ashwini.decision_responses (decision_id, choice, was_override, override_reason)
         values ($1, 'ignored', true, 'trained anyway')`,
        [inserted.rows[0]?.decision_id],
      );
      await failsWith("update ashwini.decision_responses set choice = 'x'", /append-only/);
      await failsWith("delete from ashwini.decision_responses", /append-only/);
    });
  });

  describe("PRD 8 — an override states its reason", () => {
    it("refuses an override with no reason", async () => {
      const inserted = await client.query<{ decision_id: string }>(
        `${decision("recorded", 0, "clear")} returning decision_id`,
      );
      await expect(
        client.query(
          `insert into ashwini.decision_responses (decision_id, choice, was_override)
           values ($1, 'ignored', true)`,
          [inserted.rows[0]?.decision_id],
        ),
      ).rejects.toThrow(/override_states_its_reason/);
    });
  });

  describe("privacy posture", () => {
    it("keeps every health table out of the public schema", async () => {
      const { rows } = await client.query<{ count: string }>(
        "select count(*)::text as count from pg_tables where schemaname = 'public'",
      );
      // Supabase serves `public` over PostgREST. Nothing of ours belongs there.
      expect(Number(rows[0]?.count)).toBe(0);
    });

    it("enables and forces row level security on every table", async () => {
      const { rows } = await client.query<{ tablename: string }>(
        `select c.relname as tablename
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'ashwini' and c.relkind = 'r'
           and not (c.relrowsecurity and c.relforcerowsecurity)`,
      );
      expect(rows.map((row) => row.tablename)).toEqual([]);
    });

    it("grants nothing on the schema to PUBLIC", async () => {
      const { rows } = await client.query<{ has: boolean }>(
        "select has_schema_privilege('public', 'ashwini', 'USAGE') as has",
      );
      expect(rows[0]?.has).toBe(false);
    });
  });

  describe("PRD 8 — confound thresholds are versioned data", () => {
    it("seeds every confound class the PRD lists", async () => {
      const { rows } = await client.query<{ confound_id: string }>(
        "select confound_id from ashwini.confound_definitions order by confound_id",
      );
      expect(rows.map((row) => row.confound_id)).toEqual([
        "adherence_below_threshold",
        "alcohol",
        "capture_quality",
        "confounding_medication_change",
        "illness",
        "incomplete_source_data",
        "multiple_interventions",
        "schedule_disruption",
        "sleep_debt",
        "travel",
      ]);
    });

    it("gives every definition a version", async () => {
      const { rows } = await client.query<{ count: string }>(
        `select count(*)::text as count from ashwini.confound_definitions
         where version is null or version = ''`,
      );
      expect(Number(rows[0]?.count)).toBe(0);
    });

    it("treats missing source data as blocking, not merely noted", async () => {
      const { rows } = await client.query<{ blocking: boolean; required: boolean }>(
        `select blocking, required_for_verdict as required
         from ashwini.confound_definitions where confound_id = 'incomplete_source_data'`,
      );
      expect(rows[0]).toEqual({ blocking: true, required: true });
    });
  });

  describe("the evidence vocabulary matches the domain layer", () => {
    it("has exactly the nine PRD 4.5 statuses in order", async () => {
      const { rows } = await client.query<{ labels: string[] }>(
        `select array_agg(e.enumlabel::text order by e.enumsortorder) as labels
         from pg_enum e join pg_type t on t.oid = e.enumtypid
         join pg_namespace n on n.oid = t.typnamespace
         where n.nspname = 'ashwini' and t.typname = 'evidence_status'`,
      );
      expect(rows[0]?.labels).toEqual([
        "recorded",
        "unusable",
        "rule_based",
        "noticed",
        "tracking",
        "early_signal",
        "consistent_pattern",
        "personally_useful",
        "route_out",
      ]);
    });

    it("keeps edge_status separate from the evidence vocabulary", async () => {
      const { rows } = await client.query<{ labels: string[] }>(
        `select array_agg(e.enumlabel::text order by e.enumsortorder) as labels
         from pg_enum e join pg_type t on t.oid = e.enumtypid
         join pg_namespace n on n.oid = t.typnamespace
         where n.nspname = 'ashwini' and t.typname = 'edge_status'`,
      );
      // Different vocabulary, different purpose. Conflating them is the trap.
      expect(rows[0]?.labels).not.toContain("recorded");
      expect(rows[0]?.labels).toContain("hypothesized");
    });
  });
});

/**
 * Seed a development database with synthetic records.
 *
 * Everything written here is invented. It exists so the app has something
 * plausible to render against and so integration work has a stable corpus —
 * it is not, and must never become, anyone's health data.
 *
 * Refuses to run in production, and refuses when messages already exist, so it
 * cannot be pointed at the real Supabase project by accident. Opt in with
 * ASHWINI_ALLOW_SEED=1.
 */

import { Client } from "pg";
import { postgresConnectionConfig } from "../lib/postgres-connection";

const DAY = 24 * 60 * 60 * 1000;

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required to seed.");

  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed synthetic health records in production.");
  }
  if (process.env.ASHWINI_ALLOW_SEED !== "1") {
    throw new Error("Set ASHWINI_ALLOW_SEED=1 to confirm you mean to write synthetic records.");
  }

  const client = new Client(
    postgresConnectionConfig(connectionString, process.env.ASHWINI_POSTGRES_CA),
  );
  await client.connect();

  try {
    // Check the tables this script actually writes. Checking `messages` — which
    // it does not write — meant the guard never fired and a second run failed on
    // a unique constraint instead.
    const existing = await client.query<{ count: string }>(
      `select (
         (select count(*) from ashwini.messages) +
         (select count(*) from ashwini.medications) +
         (select count(*) from ashwini.interventions) +
         (select count(*) from ashwini.meals) +
         (select count(*) from ashwini.meal_references) +
         (select count(*) from ashwini.commitments) +
         (select count(*) from ashwini.confound_evaluations)
       )::text as count`,
    );
    if (Number(existing.rows[0]?.count) > 0) {
      throw new Error(
        "This database already holds records. Seeding is for an empty development database only.",
      );
    }

    const now = new Date();

    await client.query(
      `insert into ashwini.medications (name, dose, unit, started_at, schedule_rrule, purpose, days_supply, last_fill_date)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        "sertraline",
        50,
        "mg",
        new Date(now.getTime() - 400 * DAY),
        "FREQ=DAILY;BYHOUR=8",
        "Synthetic example only",
        26,
        new Date(now.getTime() - 4 * DAY),
      ],
    );

    await client.query(
      `insert into ashwini.interventions (name, category, dose, unit, started_at, notes)
       values ($1, 'supplement', $2, $3, $4, $5)`,
      ["magnesium glycinate", 200, "mg", new Date(now.getTime() - 30 * DAY), "Synthetic example"],
    );

    // A commitment gives the Now brief something real to count down to, in place
    // of the prototype's hardcoded "4h 12m".
    await client.query(
      `insert into ashwini.commitments (starts_at, domain, title, detail, kind)
       values ($1, 'training', $2, $3, 'training'), ($4, 'training', $5, $6, 'review')`,
      [
        new Date(now.getTime() + 4 * 60 * 60 * 1000),
        "Upper body session",
        "Volume decided at the pre-session check",
        new Date(now.getTime() + 3 * 60 * 60 * 1000),
        "Pre-session energy check",
        "Decides full or reduced volume",
      ],
    );

    await client.query(
      `insert into ashwini.meals (ts, kind, description, source, confidence, kcal_low, kcal_high, protein_low_g, protein_high_g)
       values ($1, 'breakfast', $2, 'text', 'medium', 380, 520, 22, 30)`,
      [new Date(now.getTime() - 6 * 60 * 60 * 1000), "Yogurt, oats, coffee"],
    );

    await client.query(
      `insert into ashwini.meal_references (name, version, notes, kcal_low, kcal_high, protein_low_g, protein_high_g)
       values ('House Dal v1', 1, $1, 520, 720, 24, 34)`,
      ["A recurring household meal, named by the user (PRD 7.2)."],
    );

    // Confound evaluations for today, so the gate has something to resolve
    // against. Without these, every gated recommendation is correctly blocked
    // for incomplete source data — accurate, but not much of a demo.
    const evaluations: ReadonlyArray<[string, "absent" | "present"]> = [
      ["sleep_debt", "present"],
      ["illness", "absent"],
      ["travel", "absent"],
      ["alcohol", "absent"],
      ["schedule_disruption", "absent"],
      ["multiple_interventions", "absent"],
      ["incomplete_source_data", "absent"],
      ["adherence_below_threshold", "absent"],
      ["confounding_medication_change", "absent"],
      ["capture_quality", "absent"],
    ];

    for (const [confoundId, state] of evaluations) {
      await client.query(
        `insert into ashwini.confound_evaluations (confound_id, subject_kind, state, detail, window_start, window_end, evaluated_ts)
         values ($1, 'window', $2, $3, $4, $5, $6)`,
        [
          confoundId,
          state,
          state === "present" ? "6h 18m against a 7h 45m baseline" : null,
          new Date(now.getTime() - 7 * DAY),
          now,
          now,
        ],
      );
    }

    process.stdout.write("seeded synthetic development records\n");
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});

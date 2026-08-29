import "server-only";
import type { Clock } from "@/domain/clock";
import { systemClock } from "@/domain/clock";
import {
  createRulesAdvisor,
  type AdvisorOutput,
  type AttachmentRef,
  type RecordDraft,
} from "@/domain/advisor";
import type { Transaction } from "kysely";
import { db } from "./db/client";
import type { Database } from "./db/types";
import { buildSubjectContext } from "./context";
import { env } from "./env";

/**
 * The one entry point for a conversational input.
 *
 * Reads the context, asks the advisor, writes everything in a single
 * transaction. The advisor stays pure and the route handler stays thin; all the
 * ordering that matters lives here.
 */

export interface HandleUtteranceInput {
  readonly text: string;
  readonly attachments?: readonly AttachmentRef[];
  /** Client-generated, so a replayed offline write lands once. */
  readonly idempotencyKey?: string;
  /** When the user captured it, which can be well before the server saw it. */
  readonly capturedAt?: Date;
  /**
   * The earlier user message this one corrects. PRD 4.4: a correction retains
   * the original and visibly supersedes its effects — so this points the old
   * message forward at the new one and deletes nothing.
   */
  readonly correctionOf?: string;
}

export interface HandleUtteranceResult {
  readonly userMessageId: string;
  readonly advisorMessageId: string;
  readonly decisionIds: readonly string[];
  readonly output: AdvisorOutput;
  /** True when an earlier identical write already landed. */
  readonly replayed: boolean;
}

export async function handleUtterance(
  input: HandleUtteranceInput,
  clock: Clock = systemClock(env().ASHWINI_TIME_ZONE),
): Promise<HandleUtteranceResult> {
  const kysely = db();
  const advisor = createRulesAdvisor();
  const now = clock.now();

  if (input.idempotencyKey) {
    const existing = await kysely
      .selectFrom("ashwini.messages")
      .select(["message_id"])
      .where("idempotency_key", "=", input.idempotencyKey)
      .executeTakeFirst();

    if (existing) {
      // A replay is not an error and must not produce a second decision.
      const output = await advisor.respond({
        now,
        utterance: { text: input.text, attachments: input.attachments ?? [] },
        context: await buildSubjectContext(clock),
      });
      return {
        userMessageId: existing.message_id,
        advisorMessageId: existing.message_id,
        decisionIds: [],
        output,
        replayed: true,
      };
    }
  }

  const context = await buildSubjectContext(clock);
  const output = await advisor.respond({
    now,
    utterance: { text: input.text, attachments: input.attachments ?? [] },
    context,
  });

  return kysely.transaction().execute(async (trx) => {
    const userMessage = await trx
      .insertInto("ashwini.messages")
      .values({
        ts: now,
        role: "user",
        text: input.text,
        kind: "record",
        idempotency_key: input.idempotencyKey ?? null,
        captured_at: input.capturedAt ?? null,
      })
      .returning("message_id")
      .executeTakeFirstOrThrow();

    const advisorMessage = await trx
      .insertInto("ashwini.messages")
      .values({
        ts: now,
        role: "ashwini",
        text: output.reply.text,
        kind: output.reply.kind,
        receipt: output.reply.receipt,
        in_reply_to: userMessage.message_id,
        advisor_version: advisor.version,
        rule_id: output.trace.ruleId,
      })
      .returning("message_id")
      .executeTakeFirstOrThrow();

    if (input.correctionOf) {
      // The one permitted mutation on `messages`, enforced by trigger. A
      // correction that names a message which does not exist is a client bug,
      // and quietly recording it as an ordinary check-in would lose the link.
      const updated = await trx
        .updateTable("ashwini.messages")
        .set({ corrected_by: userMessage.message_id })
        .where("message_id", "=", input.correctionOf)
        .where("role", "=", "user")
        .executeTakeFirst();

      if (updated.numUpdatedRows === 0n) {
        throw new Error("The message this corrects no longer exists.");
      }
    }

    const decisionIds: string[] = [];
    for (const decision of output.decisions) {
      const row = await trx
        .insertInto("ashwini.decisions")
        .values({
          created_ts: now,
          type: decision.type,
          domain: decision.domain,
          evidence_status: decision.evidenceStatus,
          ladder_level: decision.ladderLevel,
          confidence_note: decision.confidenceNote,
          gate_outcome: decision.gateOutcome,
          gate_reason: decision.gateReason,
          confounds_checked: JSON.stringify(decision.confoundsChecked),
          source_refs: JSON.stringify(decision.sources),
          target: decision.target,
          expected_lag: decision.expectedLag,
          choices: JSON.stringify(decision.choices),
          refused: decision.refused,
          expires_at: decision.expiresAt,
          review_at: decision.reviewAt,
          advisor_version: advisor.version,
          rule_id: decision.ruleId,
          message_id: advisorMessage.message_id,
          route_destination: output.route,
        })
        .returning("decision_id")
        .executeTakeFirstOrThrow();
      decisionIds.push(row.decision_id);
    }

    for (const record of output.records) {
      const written = await writeRecord(trx, record, now, userMessage.message_id, output);
      await trx
        .insertInto("ashwini.routed_records")
        .values({
          message_id: userMessage.message_id,
          // A kind with no table of its own is still a record: the message is
          // it. Skipping the row here is what used to make a medication event
          // visible in the response and invisible after a reload.
          record_table: written?.table ?? "messages",
          record_id: written?.id ?? userMessage.message_id,
          record_kind: record.kind,
        })
        .execute();
    }

    return {
      userMessageId: userMessage.message_id,
      advisorMessageId: advisorMessage.message_id,
      decisionIds,
      output,
      replayed: false,
    };
  });
}

/**
 * Persist one structured record and report where it landed, so the message can
 * point at it. PRD 4.3: Ashwini shows what it recorded or changed.
 */
async function writeRecord(
  trx: Transaction<Database>,
  record: RecordDraft,
  now: Date,
  messageId: string,
  output: AdvisorOutput,
): Promise<{ table: string; id: string } | null> {
  switch (record.kind) {
    case "symptom": {
      const row = await trx
        .insertInto("ashwini.symptoms")
        .values({
          ts: now,
          text: record.text,
          body_region: record.bodyRegion,
          message_id: messageId,
          routed_to: output.route,
        })
        .returning("symptom_id")
        .executeTakeFirstOrThrow();
      return { table: "symptoms", id: row.symptom_id };
    }

    case "meal": {
      const row = await trx
        .insertInto("ashwini.meals")
        .values({
          ts: now,
          kind: record.mealKind,
          source: "text",
          // PRD 7.2: a text log without a recipe is a low-confidence estimate,
          // and it is stored with no numbers at all rather than invented ones.
          confidence: "low",
          message_id: messageId,
        })
        .returning("meal_id")
        .executeTakeFirstOrThrow();
      return { table: "meals", id: row.meal_id };
    }

    case "dermatology_handoff": {
      const row = await trx
        .insertInto("ashwini.dermatology_handoffs")
        .values({
          reported_ts: now,
          user_wording: record.userWording,
          routed_to: "dermatologist",
          message_id: messageId,
        })
        .returning("handoff_id")
        .executeTakeFirstOrThrow();
      return { table: "dermatology_handoffs", id: row.handoff_id };
    }

    case "therapy_mention": {
      // PRD 11.9: the fact, never the text.
      const row = await trx
        .insertInto("ashwini.therapy_mentions")
        .values({ ts: now, message_id: messageId })
        .returning("mention_id")
        .executeTakeFirstOrThrow();
      return { table: "therapy_mentions", id: row.mention_id };
    }

    // These carry no dedicated table yet: the message itself is the record, and
    // routed_records would point at nothing. Deliberately not invented.
    case "context_note":
    case "medication_event":
    case "interaction_check_request":
      return null;
  }
}

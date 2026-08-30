import "server-only";
import { createHmac } from "node:crypto";
import type { Clock } from "@/domain/clock";
import { systemClock } from "@/domain/clock";
import {
  classifySensitiveContent,
  createRulesAdvisor,
  SENSITIVE_REDACTION,
  type AdvisorOutput,
  type AttachmentRef,
  type DecisionDraft,
  type RecordDraft,
  type SensitiveRuleId,
} from "@/domain/advisor";
import type { Kysely, Transaction } from "kysely";
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
  /** The durable representation; protected wording is replaced before persistence. */
  readonly userText: string;
  readonly advisorMessageId: string;
  readonly ts: Date;
  readonly decisionIds: readonly string[];
  readonly output: AdvisorOutput;
  /** True when an earlier identical write already landed. */
  readonly replayed: boolean;
}

export class IdempotencyConflictError extends Error {
  constructor(message = "That idempotency key was already used for a different check-in.") {
    super(message);
    this.name = "IdempotencyConflictError";
  }
}

export class CorrectionTargetError extends Error {
  constructor() {
    super("The message this corrects is missing or has already been superseded.");
    this.name = "CorrectionTargetError";
  }
}

/**
 * PRD 11.9 and the crisis boundary are persistence rules, not copy rules.
 * Classification happens before the transaction so the raw utterance can be
 * discarded here instead of landing in the generic message table.
 */
function retainedUserText(ruleId: SensitiveRuleId | null, input: string): string {
  return ruleId ? SENSITIVE_REDACTION[ruleId] : input;
}

export async function handleUtterance(
  input: HandleUtteranceInput,
  clock: Clock = systemClock(env().ASHWINI_TIME_ZONE),
): Promise<HandleUtteranceResult> {
  const kysely = db();
  const advisor = createRulesAdvisor();
  const now = clock.now();
  const sensitiveRuleId = classifySensitiveContent(input.text);

  if (input.idempotencyKey) {
    const existing = await kysely
      .selectFrom("ashwini.messages")
      .select(["message_id", "ts", "text", "captured_at", "input_fingerprint"])
      .where("idempotency_key", "=", input.idempotencyKey)
      .executeTakeFirst();

    if (existing) {
      return loadPersistedReplay(kysely, existing, input, sensitiveRuleId);
    }
  }

  const context = await buildSubjectContext(clock);
  const output = await advisor.respond({
    now,
    utterance: { text: input.text, attachments: input.attachments ?? [] },
    context,
  });

  // Crisis routing remains terminal. Therapy privacy is independent of route
  // priority: a mixed therapy + urgent symptom is redacted but still routes to
  // emergency care.
  if (sensitiveRuleId === "crisis" && output.trace.ruleId !== "crisis") {
    throw new Error("Crisis-routing invariant failed.");
  }

  try {
    return await kysely.transaction().execute(async (trx) => {
      const userMessage = await trx
        .insertInto("ashwini.messages")
        .values({
          ts: now,
          role: "user",
          text: retainedUserText(sensitiveRuleId, input.text),
          kind: "record",
          idempotency_key: input.idempotencyKey ?? null,
          input_fingerprint: inputFingerprint(input),
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
          // A correction pointer is one-way append-only history. A stale tab
          // must not replace the correction that already won this race.
          .where("corrected_by", "is", null)
          .executeTakeFirst();

        if (updated.numUpdatedRows === 0n) {
          throw new CorrectionTargetError();
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
        const written = await writeRecord(
          trx,
          record,
          now,
          userMessage.message_id,
          output,
          sensitiveRuleId,
        );
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
        userText: retainedUserText(sensitiveRuleId, input.text),
        advisorMessageId: advisorMessage.message_id,
        ts: now,
        decisionIds,
        output,
        replayed: false,
      };
    });
  } catch (error) {
    // Two first attempts can reach the unique idempotency key together. The
    // losing transaction becomes a replay of the winner instead of a 503.
    if (input.idempotencyKey && isUniqueViolation(error)) {
      const existing = await kysely
        .selectFrom("ashwini.messages")
        .select(["message_id", "ts", "text", "captured_at", "input_fingerprint"])
        .where("idempotency_key", "=", input.idempotencyKey)
        .executeTakeFirst();
      if (existing) return loadPersistedReplay(kysely, existing, input, sensitiveRuleId);
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

/**
 * Bind an idempotency key to the exact intent without retaining protected raw
 * wording in another column. A server-only pepper makes this unsuitable for a
 * database-only dictionary attack; the HMAC is comparison-only, never returned
 * to the client, and never used as an inference source.
 */
function inputFingerprint(input: HandleUtteranceInput): string | null {
  if (!input.idempotencyKey) return null;
  const pepper = env().ASHWINI_INPUT_HMAC_KEY;
  if (!pepper) return null;
  return createHmac("sha256", pepper)
    .update(
      JSON.stringify({
        version: 1,
        key: input.idempotencyKey,
        text: input.text,
        attachments: input.attachments ?? [],
        capturedAt: input.capturedAt?.toISOString() ?? null,
        correctionOf: input.correctionOf ?? null,
      }),
    )
    .digest("hex");
}

/**
 * A replay returns what was actually written. Re-running the advisor here used
 * to create an unstored answer from today's context and could contradict the
 * immutable turn the idempotency key referred to.
 */
async function loadPersistedReplay(
  kysely: Kysely<Database>,
  existing: {
    message_id: string;
    ts: Date;
    text: string;
    captured_at: Date | null;
    input_fingerprint: string | null;
  },
  input: HandleUtteranceInput,
  inputSensitiveRuleId: SensitiveRuleId | null,
): Promise<HandleUtteranceResult> {
  const reply = await kysely
    .selectFrom("ashwini.messages")
    .select(["message_id", "text", "kind", "receipt", "advisor_version", "rule_id"])
    .where("role", "=", "ashwini")
    .where("in_reply_to", "=", existing.message_id)
    .orderBy("ts", "asc")
    .executeTakeFirst();

  if (!reply?.kind || !reply.rule_id) {
    throw new Error("The stored idempotent check-in is incomplete and cannot be replayed.");
  }

  const expectedFingerprint = inputFingerprint(input);
  if (existing.input_fingerprint) {
    if (!expectedFingerprint || existing.input_fingerprint !== expectedFingerprint) {
      throw new IdempotencyConflictError();
    }
  }

  const storedSensitiveRuleId = sensitiveRuleIdForStoredText(existing.text);
  if (storedSensitiveRuleId && !existing.input_fingerprint) {
    // A protected legacy row intentionally has no raw text to compare. Without
    // the bound digest added in migration 015, an exact replay is unknowable;
    // fail closed instead of treating every phrase in the category as equal.
    throw new IdempotencyConflictError();
  } else if (storedSensitiveRuleId) {
    if (
      inputSensitiveRuleId !== storedSensitiveRuleId ||
      existing.text !== SENSITIVE_REDACTION[storedSensitiveRuleId]
    ) {
      throw new IdempotencyConflictError();
    }
  } else if (
    inputSensitiveRuleId ||
    (!existing.input_fingerprint && existing.text !== input.text)
  ) {
    throw new IdempotencyConflictError();
  }

  const capturedAt = input.capturedAt?.getTime() ?? null;
  if ((existing.captured_at?.getTime() ?? null) !== capturedAt) {
    throw new IdempotencyConflictError();
  }

  const correctedTarget = await kysely
    .selectFrom("ashwini.messages")
    .select("message_id")
    .where("corrected_by", "=", existing.message_id)
    .executeTakeFirst();
  if ((correctedTarget?.message_id ?? undefined) !== input.correctionOf) {
    throw new IdempotencyConflictError();
  }

  const [storedDecisions, routed] = await Promise.all([
    kysely
      .selectFrom("ashwini.decisions")
      .selectAll()
      .where("message_id", "=", reply.message_id)
      .orderBy("created_ts", "asc")
      .execute(),
    kysely
      .selectFrom("ashwini.routed_records")
      .select("record_kind")
      .where("message_id", "=", existing.message_id)
      .execute(),
  ]);

  const decisions: DecisionDraft[] = storedDecisions.map((decision) => ({
    type: decision.type,
    domain: decision.domain,
    evidenceStatus: decision.evidence_status,
    ladderLevel: decision.ladder_level as DecisionDraft["ladderLevel"],
    gateOutcome: decision.gate_outcome,
    gateReason: decision.gate_reason,
    confoundsChecked: Array.isArray(decision.confounds_checked)
      ? (decision.confounds_checked as DecisionDraft["confoundsChecked"])
      : [],
    confidenceNote: decision.confidence_note,
    target: decision.target,
    expectedLag: decision.expected_lag,
    choices: Array.isArray(decision.choices)
      ? decision.choices.filter((choice): choice is string => typeof choice === "string")
      : [],
    refused: decision.refused,
    sources: Array.isArray(decision.source_refs)
      ? (decision.source_refs as DecisionDraft["sources"])
      : [],
    expiresAt: decision.expires_at,
    reviewAt: decision.review_at,
    ruleId: decision.rule_id,
  }));

  return {
    userMessageId: existing.message_id,
    userText: existing.text,
    advisorMessageId: reply.message_id,
    ts: existing.ts,
    decisionIds: storedDecisions.map((decision) => decision.decision_id),
    output: {
      reply: { text: reply.text, kind: reply.kind, receipt: reply.receipt ?? "" },
      decisions,
      records: routed.map((row) => replayRecord(row.record_kind)),
      // Follow-ups are deliberately not re-asked from history. The persisted
      // reply remains authoritative; no current-context text is regenerated.
      followUp: null,
      route: storedDecisions[0]?.route_destination ?? null,
      trace: { ruleId: reply.rule_id },
    },
    replayed: true,
  };
}

function sensitiveRuleIdForStoredText(value: string): SensitiveRuleId | null {
  if (value === SENSITIVE_REDACTION.crisis) return "crisis";
  if (value === SENSITIVE_REDACTION["therapy-content"]) return "therapy-content";
  return null;
}

function replayRecord(kind: RecordDraft["kind"]): RecordDraft {
  switch (kind) {
    case "context_note":
      return { kind, text: "Stored context note." };
    case "symptom":
      return { kind, text: "Stored symptom record.", bodyRegion: null };
    case "meal":
      return { kind, mealKind: null };
    case "medication_event":
      return { kind, text: "Stored medication event." };
    case "dermatology_handoff":
      return { kind, userWording: "Stored dermatology handoff." };
    case "interaction_check_request":
      return { kind, items: [] };
    case "therapy_mention":
      return { kind };
  }
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
  sensitiveRuleId: SensitiveRuleId | null,
): Promise<{ table: string; id: string } | null> {
  switch (record.kind) {
    case "symptom": {
      const row = await trx
        .insertInto("ashwini.symptoms")
        .values({
          ts: now,
          text: sensitiveRuleId ? SENSITIVE_REDACTION[sensitiveRuleId] : record.text,
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
          user_wording: sensitiveRuleId ? SENSITIVE_REDACTION[sensitiveRuleId] : record.userWording,
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

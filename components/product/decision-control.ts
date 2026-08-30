import type { OpenDecision } from "@/lib/record-client";
import type { CheckinRecord } from "@/lib/product-model";

export interface DecisionControlCopy {
  readonly heading: string;
  readonly description: string;
  readonly actionLabel: string;
}

/**
 * UI language for the exact kind of unresolved decision on screen.
 *
 * A missing choice is not, by itself, a professional handoff. Data-quality
 * blocks and care routes both allow acknowledgment, but acknowledging them has
 * different meaning and the interface must not collapse those boundaries.
 */
export function decisionControlCopy(decision: OpenDecision): DecisionControlCopy {
  if (decision.choices.length > 0) {
    return {
      heading: "Choose the response that fits",
      description:
        "Your response is written to this decision and remains visible with the check-in.",
      actionLabel: "Record response",
    };
  }

  if (decision.route) {
    return {
      heading: "Acknowledge this care boundary",
      description:
        "Contact the named professional yourself. Acknowledging closes this prompt in Ashwini; it does not send a handoff or mark the concern resolved.",
      actionLabel: "Acknowledge care boundary",
    };
  }

  if (decision.type === "data_quality_block") {
    return {
      heading: "Acknowledge this evidence gap",
      description:
        "The requested answer is withheld because required information is missing or unusable. Acknowledging closes the prompt; it does not make the evidence usable.",
      actionLabel: "Acknowledge evidence gap",
    };
  }

  return {
    heading: "Acknowledge this prompt",
    description:
      "Acknowledging closes this prompt in Ashwini without marking the underlying situation resolved.",
    actionLabel: "Mark as acknowledged",
  };
}

function recordedResponseTime(record: CheckinRecord): number {
  const value = record.response.decision?.respondedAt ?? record.recordedAt;
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function latestRecordedDecisionResponse(
  checkins: readonly CheckinRecord[],
): CheckinRecord | undefined {
  const supersededIds = new Set(
    checkins.flatMap((record) => (record.correctionOf ? [record.correctionOf] : [])),
  );
  return checkins
    .filter(
      (record) =>
        !supersededIds.has(record.id) &&
        Boolean(record.response.decision?.selectedChoice),
    )
    .slice()
    .sort((left, right) => recordedResponseTime(right) - recordedResponseTime(left))[0];
}

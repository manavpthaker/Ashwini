/** Versioned, minimal replay metadata; never an input or provider-error payload. */
import { z } from "zod";
import type { AdvisorOutput } from "@/domain/advisor/types";

const schema = z
  .object({
    version: z.literal(1),
    followUp: z.string().max(250).nullable(),
    trace: z
      .object({
        ruleId: z.string().min(1).max(120),
        mode: z.enum(["rules_only", "model", "model_unavailable"]).optional(),
        reason: z
          .enum([
            "not_configured",
            "terminal_rule",
            "provider_auth",
            "provider_rate_limit",
            "provider_error",
            "timeout",
            "network",
            "invalid_output",
            "unsupported_provenance",
            "research_error",
          ])
          .optional(),
      })
      .strict(),
  })
  .strict();

export function encodeAdvisorReplyMetadata(
  output: Pick<AdvisorOutput, "followUp" | "trace">,
): string {
  const result = schema.safeParse({ version: 1, followUp: output.followUp, trace: output.trace });
  if (!result.success)
    throw new Error("Advisor reply metadata does not match the durable contract.");
  return JSON.stringify(result.data);
}

export function decodeAdvisorReplyMetadata(
  value: unknown,
  ruleId: string,
): Pick<AdvisorOutput, "followUp" | "trace"> {
  // Old rows predate exact follow-up/mode storage. Preserve their known durable
  // representation; never re-run current rules or guess from the reply text.
  if (value === null || value === undefined) return { followUp: null, trace: { ruleId } };
  const result = schema.safeParse(value);
  if (!result.success || result.data.trace.ruleId !== ruleId) {
    throw new Error("The stored advisor reply metadata is invalid and cannot be replayed.");
  }
  return { followUp: result.data.followUp, trace: result.data.trace };
}

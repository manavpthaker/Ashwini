/**
 * Server-side adapter for Examine Connect.
 *
 * This module must be called by the private Ashwini service, never from the
 * exported browser bundle: the API key is a server credential and submitted
 * medication/supplement names are private health context.
 */

const EXAMINE_INTERACTIONS_URL = "https://connect.examine.com/api/v1/safety-database/interactions";

export interface ExamineInteractionFinding {
  level_evidence: "probable" | "possible" | "theoretical" | string;
  level_severity: "severe" | "moderate" | "minor" | "unknown" | string;
  effect_tags: readonly string[];
  notes: string;
}

export interface ExamineInteraction {
  item_a: string;
  item_a_group?: string | null;
  item_a_matched_from?: string;
  item_a_url?: string;
  item_a_notes?: string | null;
  item_b: string;
  item_b_group?: string | null;
  item_b_matched_from?: string;
  item_b_url?: string;
  item_b_notes?: string | null;
  finding: ExamineInteractionFinding;
}

export interface ExamineReference {
  pmid?: string | number;
  title?: string;
  url?: string;
  [key: string]: unknown;
}

export interface ExamineInteractionResponse {
  data: readonly ExamineInteraction[];
  references: readonly ExamineReference[];
  status: string;
  checked_names: readonly string[];
  resolved_names?: Readonly<Record<string, string>>;
}

export class ExamineConnectError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ExamineConnectError";
  }
}

export async function checkExamineInteractions(
  rawItems: readonly string[],
  options: { apiKey?: string; signal?: AbortSignal } = {},
): Promise<ExamineInteractionResponse> {
  const items = [...new Set(rawItems.map((item) => item.trim()).filter(Boolean))];

  if (items.length < 2) {
    throw new ExamineConnectError("An interaction check needs at least two distinct medication or supplement names.");
  }
  if (items.length > 25) {
    throw new ExamineConnectError("Examine Connect accepts at most 25 items in one regimen check.");
  }

  const apiKey = options.apiKey ?? process.env.EXAMINE_CONNECT_API_KEY;
  if (!apiKey) {
    throw new ExamineConnectError("Examine Connect is not authorized. Configure EXAMINE_CONNECT_API_KEY on the private service.");
  }

  const response = await fetch(EXAMINE_INTERACTIONS_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ items }),
    cache: "no-store",
    signal: options.signal,
  });

  if (!response.ok) {
    throw new ExamineConnectError(`Examine Connect returned HTTP ${response.status}.`, response.status);
  }

  const result = await response.json() as ExamineInteractionResponse;
  if (!Array.isArray(result.data) || !Array.isArray(result.references) || !Array.isArray(result.checked_names)) {
    throw new ExamineConnectError("Examine Connect returned an unexpected response shape.");
  }

  return result;
}

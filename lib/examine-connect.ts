/**
 * Server-side adapter for Examine Connect.
 *
 * This module must be called by the private Ashwini service, never from the
 * exported browser bundle: the API key is a server credential and submitted
 * medication/supplement names are private health context.
 *
 * The `server-only` import makes that a build error rather than a convention —
 * importing this from a client component now fails the build instead of
 * shipping the module to a browser.
 */
import "server-only";

const EXAMINE_INTERACTIONS_URL = "https://connect.examine.com/api/v1/safety-database/interactions";

/**
 * A hung upstream must not hang the conversation. The adapter accepted an
 * external signal but never created its own, so a stalled Examine endpoint
 * would block a POST /api/conversation indefinitely.
 */
const DEFAULT_TIMEOUT_MS = 8_000;

/** One retry, and only for transient failures — never for a 4xx. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

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
  /**
   * Whether repeating the identical request could plausibly succeed.
   *
   * Explicit rather than inferred: a malformed response body will be malformed
   * again, and a 4xx just spends the rate limit. Only transport failures and
   * transient upstream statuses are worth a second attempt.
   */
  readonly retryable: boolean;
  readonly status: number | undefined;

  constructor(message: string, options: { status?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = "ExamineConnectError";
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

export interface ExamineOptions {
  apiKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export async function checkExamineInteractions(
  rawItems: readonly string[],
  options: ExamineOptions = {},
): Promise<ExamineInteractionResponse> {
  const items = [...new Set(rawItems.map((item) => item.trim()).filter(Boolean))];

  if (items.length < 2) {
    throw new ExamineConnectError(
      "An interaction check needs at least two distinct medication or supplement names.",
    );
  }
  if (items.length > 25) {
    throw new ExamineConnectError("Examine Connect accepts at most 25 items in one regimen check.");
  }

  const apiKey = options.apiKey ?? process.env.EXAMINE_CONNECT_API_KEY;
  if (!apiKey) {
    // Fails closed, and PRD 7.3 is why: silence is never evidence that no
    // interaction exists, so an unauthorised adapter must refuse rather than
    // return an empty result that reads like an all-clear.
    throw new ExamineConnectError(
      "Examine Connect is not authorized. Configure EXAMINE_CONNECT_API_KEY on the private service.",
    );
  }

  const attempt = (): Promise<ExamineInteractionResponse> => requestOnce(items, apiKey, options);

  try {
    return await attempt();
  } catch (error) {
    if (!isRetryable(error)) throw error;
    return attempt();
  }
}

async function requestOnce(
  items: readonly string[],
  apiKey: string,
  options: ExamineOptions,
): Promise<ExamineInteractionResponse> {
  const doFetch = options.fetchImpl ?? fetch;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await doFetch(EXAMINE_INTERACTIONS_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ items }),
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new ExamineConnectError("Examine Connect did not respond in time.", {
        retryable: true,
      });
    }
    if (error instanceof Error && error.name === "AbortError") {
      // The caller cancelled deliberately; retrying would ignore that.
      throw new ExamineConnectError("The Examine Connect request was cancelled.");
    }
    throw new ExamineConnectError(`Examine Connect could not be reached: ${String(error)}`, {
      retryable: true,
    });
  }

  if (!response.ok) {
    throw new ExamineConnectError(`Examine Connect returned HTTP ${response.status}.`, {
      status: response.status,
      retryable: RETRYABLE_STATUS.has(response.status),
    });
  }

  // An HTML error page from a proxy would otherwise throw a raw SyntaxError,
  // escaping the ExamineConnectError contract every caller is written against.
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new ExamineConnectError("Examine Connect returned a body that is not JSON.", {
      status: response.status,
    });
  }

  const result = parsed as ExamineInteractionResponse;
  if (
    !result ||
    !Array.isArray(result.data) ||
    !Array.isArray(result.references) ||
    !Array.isArray(result.checked_names)
  ) {
    throw new ExamineConnectError("Examine Connect returned an unexpected response shape.");
  }

  return result;
}

function isRetryable(error: unknown): boolean {
  return error instanceof ExamineConnectError && error.retryable;
}

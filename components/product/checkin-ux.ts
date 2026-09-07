import { ConversationError } from "@/lib/checkin-client";
import { hasMeaningfulCheckinInput, withoutCorrectionLabel } from "@/lib/checkin-input";
import type { CheckinRecord } from "@/lib/product-model";

export function correctionDraft(record: CheckinRecord, addDetail = false): string {
  const original = withoutCorrectionLabel(record.originalInput).trim();
  return addDetail ? `${original} — ` : original;
}

export function hasCorrectionChange(
  input: string,
  record: CheckinRecord,
  addingDetail: boolean,
): boolean {
  if (!hasMeaningfulCheckinInput(input)) return false;
  const candidate = withoutCorrectionLabel(input).trim();
  const original = withoutCorrectionLabel(record.originalInput).trim();
  if (candidate === original) return false;
  if (addingDetail && candidate === `${original} —`) return false;
  return true;
}

export function checkinFailureNotice(cause: unknown): string {
  if (cause instanceof ConversationError) {
    if (cause.status === 409) {
      return `${cause.message} The record changed; any available updates are shown below. Your wording is still here as a new check-in; review it before saving.`;
    }
    if (cause.status >= 400 && cause.status < 500) return cause.message;
    return `${cause.message} Your wording is still here. Retry the unchanged draft to confirm the same write without creating a duplicate.`;
  }
  return "That check-in could not be confirmed. Your wording is still here. Retry the unchanged draft to confirm the same write without creating a duplicate.";
}

/** A failed secondary read does not prevent a new server-authoritative check-in. */
export function checkinSubmissionAllowed(input: {
  draft: string;
  submitting: boolean;
  correcting: boolean;
  correctionReady: boolean;
  historyLoading: boolean;
  historyError: string | null;
}): boolean {
  return hasMeaningfulCheckinInput(input.draft) && !input.submitting && input.correctionReady &&
    (!input.correcting || (!input.historyLoading && !input.historyError));
}

/** Strip the optional correction label without accepting an empty correction. */
export function withoutCorrectionLabel(input: string): string {
  return input.replace(/^\s*correction\s*:\s*/i, "");
}

export function hasMeaningfulCheckinInput(input: string): boolean {
  return /[\p{L}\p{N}]/u.test(withoutCorrectionLabel(input).trim());
}

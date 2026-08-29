/**
 * Small string helpers for user-facing copy.
 *
 * These build sentences the user reads inside safety route-outs and gate
 * explanations, so the grammar is part of the product, not incidental.
 */

/**
 * Join names into a readable clause: "a", "a and b", "a, b, and c".
 *
 * `whenEmpty` is what to say instead when there is nothing to name — callers
 * differ ("your medications" reads better than "these items" in a pharmacist
 * handoff), so it is required rather than defaulted.
 */
export function formatList(items: readonly string[], whenEmpty: string): string {
  if (items.length === 0) return whenEmpty;
  if (items.length === 1) return items[0] as string;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** "is" or "are", agreeing with a list built by formatList. */
export function agreeingVerb(count: number): string {
  return count === 1 ? "is" : "are";
}

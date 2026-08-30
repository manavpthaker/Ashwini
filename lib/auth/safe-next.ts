/**
 * Accept only an internal path for post-auth navigation.
 *
 * `startsWith("/")` is insufficient: `//example.com` and backslash variants
 * are interpreted as external hosts by URL parsers. Returning a normalized
 * path also prevents a later caller from reinterpreting the original string.
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\") || /%5c/i.test(value)) return null;

  try {
    const base = new URL("https://ashwini.invalid");
    const resolved = new URL(value, base);
    if (resolved.origin !== base.origin) return null;
    const normalized = `${resolved.pathname}${resolved.search}${resolved.hash}`;
    // Dot-segment normalization can turn an apparently rooted path such as
    // `/%2e%2e//host` into a protocol-relative URL. Validate what we return,
    // not only what the caller supplied.
    if (!normalized.startsWith("/") || normalized.startsWith("//")) return null;
    if (normalized.includes("\\") || /%5c/i.test(normalized)) return null;
    const checked = new URL(normalized, base);
    if (checked.origin !== base.origin) return null;
    return normalized;
  } catch {
    return null;
  }
}

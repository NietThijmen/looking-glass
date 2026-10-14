/**
 * True when `url` has exactly the given origin (scheme + host + port).
 * Compares scheme and host by hand because WHATWG `URL.origin` is `"null"` for
 * custom schemes like `app:`.
 */
export function hasOrigin(url: string | undefined, origin: string): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}` === origin
  } catch {
    return false
  }
}

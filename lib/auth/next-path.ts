// Only same-site relative paths may be used as a post-login destination (no open redirects).
// WHATWG URL parsing strips tab/LF/CR, so `/\t//evil.test` would otherwise resolve off-site:
// reject every C0 control, space, DEL and backslash before the shape checks.
export function safeNextPath(raw: string | null | undefined, fallback = '/'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || /[\\\x00-\x20\x7f]/.test(raw)) return fallback;
  return raw;
}

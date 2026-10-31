// L13/A07: CSRF guard for state-changing handlers. A cross-site <form> can only send urlencoded,
// multipart or plain bodies, never application/json — so JSON-only endpoints (mirroring /api/rsvp)
// cannot be driven by another site. Pure: takes the raw header value.
export function isJsonContentType(value: string | null | undefined): boolean {
  return value?.toLowerCase().startsWith('application/json') ?? false;
}

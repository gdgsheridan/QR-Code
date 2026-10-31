// SPEC F13 (v0.11.28): which reply-by date an invitee sees. The event's reply-by date while it's still ahead,
// otherwise (a late invite, or none set) when their invitation really closes; null when it never closes.
export function shownReplyBy(replyBy: string | null, closesAt: string | null, now: Date): string | null {
  return replyBy !== null && Date.parse(replyBy) > now.getTime() ? replyBy : closesAt;
}

// The reply-by date to ask for alongside the real close: only while it's ahead and earlier than the close
// (or there is no close). Null: just show the close.
export function earlierReplyBy(replyBy: string | null, closesAt: string | null, now: Date): string | null {
  const shown = shownReplyBy(replyBy, closesAt, now);
  if (shown === null || shown === closesAt) return null;
  return closesAt === null || Date.parse(shown) < Date.parse(closesAt) ? shown : null;
}

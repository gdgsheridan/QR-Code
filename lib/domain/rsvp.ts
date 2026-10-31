// SPEC F13 (v0.11.27): which reply-by date an invitee sees. The event's reply-by date while it's still ahead,
// otherwise (a late invite, or none set) when their invitation really closes; null when it never closes.
export function shownReplyBy(replyBy: string | null, closesAt: string | null, now: Date): string | null {
  return replyBy !== null && Date.parse(replyBy) > now.getTime() ? replyBy : closesAt;
}

import { daysUntil, formatEventDateTime } from '@/lib/domain/event-time';
import { escapeHtml } from '@/lib/domain/html';
import { venueMapUrl } from '../links';
import type { RenderedEmail } from './pass';
import { button, COUNTDOWN, details, emailPage, HEADLINE, link, p, SIGN_OFF_TEXT } from './layout';

export interface RsvpEmailInput {
  firstName: string;
  event: { name: string; venue: string; startsAt: string; timezone: string };
  rsvpUrl: string;
  /** When the invitation stops taking a Yes (v0.9); null: no deadline. */
  closesAt: string | null;
  /** v0.11.28: an earlier date to reply by, while it's ahead (`earlierReplyBy()`); the invitation still closes at closesAt. */
  replyBy?: string | null;
  /** One of the reminders before the deadline (F13). */
  reminder?: boolean;
  /** When the email is rendered (the send), for the reminder's countdown; default: now. */
  now?: Date;
}

// SPEC F13 / §12: the invitation. The link carries the RSVP token only in the fragment (I-3).
export function renderRsvpEmail(input: RsvpEmailInput): RenderedEmail {
  const when = formatEventDateTime(input.event.startsAt, input.event.timezone);
  const mapUrl = venueMapUrl(input.event.venue);
  const fmt = (at: string | null | undefined) => (at ? formatEventDateTime(at, input.event.timezone) : null);
  const closes = fmt(input.closesAt);
  const replyBy = fmt(input.replyBy);
  // Only the close withdraws anyone (F13), so "counts as a no" goes with the close, never with the reply-by date.
  const NO_REPLY = 'no reply by then counts as a no, and your spot goes to someone on the waitlist.';
  const deadline: [string, string] | null = replyBy && closes
    ? [`Please reply by ${replyBy}.`, `Invitations close ${closes}; ${NO_REPLY}`]
    : replyBy
      ? [`Please reply by ${replyBy}.`, '']
      : closes
        ? [`Please reply by ${closes}.`, `No reply by then counts as a no, and your spot goes to someone on the waitlist.`]
        : null;
  // v0.11.49 (owner's request): the reminder counts the days to the event instead of naming the reply-by date.
  const days = daysUntil(input.event.startsAt, input.now ?? new Date(), input.event.timezone);
  const count: [string, string] | null = days > 1 ? ['starts in', `${days} days`] : days === 1 ? ['starts', 'tomorrow'] : days === 0 ? ['starts', 'today'] : null;
  const countdown = count && count.join(' ');
  const e = {
    first: escapeHtml(input.firstName),
    event: escapeHtml(input.event.name),
    when: escapeHtml(when),
    venue: escapeHtml(input.event.venue),
    url: escapeHtml(input.rsvpUrl),
  };

  const html = emailPage(new URL(input.rsvpUrl).origin, input.reminder ? 'Reminder: please reply' : 'You’re invited', [
    p(`Hi ${e.first},`),
    // The reminder's headline ends in the count, set large: "Sheridan Datathon 2026 starts in" / "4 days".
    ...(input.reminder && count
      ? [p(`${e.event} ${count[0]}`, `margin:0 0 6px;${HEADLINE}`), p(count[1], `margin:0 0 20px;${COUNTDOWN}`), p("You're invited, and we haven't heard back from you yet. Will you be there?")]
      : [p(`${input.reminder ? `A reminder: you're invited to <strong>${e.event}</strong>, and we haven't heard back yet.` : `You're invited to <strong>${e.event}</strong>.`} Will you be there?`, HEADLINE)]),
    details([['When', e.when], ['Where', mapUrl ? link(escapeHtml(mapUrl), e.venue) : e.venue]]),
    ...(deadline ? [p(`<strong>${escapeHtml(deadline[0])}</strong>${deadline[1] && ` ${escapeHtml(deadline[1])}`}`)] : []),
    button(e.url, 'Reply to the invitation'),
  ].join('\n'), `We use your details only to run ${e.event}: admission, meals, attendance and emergencies. Dietary notes and emergency contacts are deleted 30 days after the event.`);

  const text = [
    `Hi ${input.firstName},`,
    '',
    input.reminder ? `A reminder: you're invited to ${input.event.name}${countdown ? `, which ${countdown}` : ''}, and we haven't heard back yet. Will you be there?` : `You're invited to ${input.event.name}. Will you be there?`,
    '',
    `When: ${when}`,
    `Where: ${input.event.venue}${mapUrl ? `: ${mapUrl}` : ''}`,
    '',
    ...(deadline ? [deadline.filter(Boolean).join(' '), ''] : []),
    `Reply to the invitation: ${input.rsvpUrl}`,
    '',
    SIGN_OFF_TEXT,
    '',
    `We use your details only to run ${input.event.name}: admission, meals, attendance and emergencies. Dietary notes and emergency contacts are deleted 30 days after the event.`,
  ].join('\n');

  const subject = !input.reminder ? `You're invited: ${input.event.name}`
    : countdown ? `Reminder: ${input.event.name} ${countdown}` : `Reminder: you're invited to ${input.event.name}`;
  return { subject, html, text, inlineImages: [] };
}

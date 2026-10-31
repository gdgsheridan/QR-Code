import { formatEventDateTime } from '@/lib/domain/event-time';
import { escapeHtml } from '@/lib/domain/html';
import type { RenderedEmail } from './pass';
import { button, details, emailPage, HEADLINE, p, SIGN_OFF_TEXT } from './layout';

export interface RsvpEmailInput {
  firstName: string;
  event: { name: string; venue: string; startsAt: string; timezone: string };
  rsvpUrl: string;
  /** When the invitation stops taking a Yes (v0.9); null: no deadline. */
  closesAt: string | null;
  /** One of the reminders before the deadline (F13). */
  reminder?: boolean;
}

// SPEC F13 / §12: the invitation. The link carries the RSVP token only in the fragment (I-3).
export function renderRsvpEmail(input: RsvpEmailInput): RenderedEmail {
  const when = formatEventDateTime(input.event.startsAt, input.event.timezone);
  const by = input.closesAt ? formatEventDateTime(input.closesAt, input.event.timezone) : null;
  const deadline = by ? `Please reply by ${by}. No reply by then counts as a no, and your spot goes to someone on the waitlist.` : null;
  const e = {
    first: escapeHtml(input.firstName),
    event: escapeHtml(input.event.name),
    when: escapeHtml(when),
    venue: escapeHtml(input.event.venue),
    url: escapeHtml(input.rsvpUrl),
  };

  const html = emailPage(new URL(input.rsvpUrl).origin, input.reminder ? 'Reminder: please reply' : 'You’re invited', [
    p(`Hi ${e.first},`),
    p(`${input.reminder ? `A reminder: you're invited to <strong>${e.event}</strong>, and we haven't heard back yet.` : `You're invited to <strong>${e.event}</strong>.`} Will you be there?`, HEADLINE),
    details([['When', e.when], ['Where', e.venue]]),
    ...(by ? [p(`<strong>Please reply by ${escapeHtml(by)}.</strong> No reply by then counts as a no, and your spot goes to someone on the waitlist.`)] : []),
    button(e.url, 'Reply to the invitation'),
  ].join('\n'), `We use your details only to run ${e.event}: admission, meals, attendance and emergencies. Dietary notes and emergency contacts are deleted 30 days after the event.`);

  const text = [
    `Hi ${input.firstName},`,
    '',
    input.reminder ? `A reminder: you're invited to ${input.event.name}, and we haven't heard back yet. Will you be there?` : `You're invited to ${input.event.name}. Will you be there?`,
    '',
    `When: ${when}`,
    `Where: ${input.event.venue}`,
    '',
    ...(deadline ? [deadline, ''] : []),
    `Reply to the invitation: ${input.rsvpUrl}`,
    '',
    SIGN_OFF_TEXT,
    '',
    `We use your details only to run ${input.event.name}: admission, meals, attendance and emergencies. Dietary notes and emergency contacts are deleted 30 days after the event.`,
  ].join('\n');

  const subject = input.reminder && by
    ? `Reminder: reply by ${by.split(' · ')[0] ?? by} — ${input.event.name}`
    : `You're invited: ${input.event.name} — will you be there?`;
  return { subject, html, text, inlineImages: [] };
}

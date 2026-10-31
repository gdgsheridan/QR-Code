import { formatEventDateTime } from '@/lib/domain/event-time';
import { escapeHtml } from '@/lib/domain/html';
import { DISCORD_URL, GOOGLE_GROUP_URL, HACKER_PACKAGE_URL } from '../links';
import type { InlineImage } from '../provider';
import { button, details, emailPage, HEADLINE, link, list, p, qr, SIGN_OFF_TEXT } from './layout';

export interface PassEmailInput {
  firstName: string;
  event: { name: string; venue: string; startsAt: string; timezone: string };
  passUrl: string;
  qrPng: Buffer;
  /** v0.9: /me/profile, where they finish setting up (F14). */
  profileUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  inlineImages: InlineImage[];
}

// SPEC §12. Body order: greeting, event, local time, venue, QR, pass link, profile setup and
// the event's links (v0.9), privacy line. The QR is an inline cid: attachment, never a data: URI.
export function renderPassEmail(input: PassEmailInput): RenderedEmail {
  const when = formatEventDateTime(input.event.startsAt, input.event.timezone);
  const e = {
    first: escapeHtml(input.firstName),
    event: escapeHtml(input.event.name),
    when: escapeHtml(when),
    venue: escapeHtml(input.event.venue),
    url: escapeHtml(input.passUrl),
    profile: escapeHtml(input.profileUrl),
  };
  const setupWhat = 'your emergency contact, whether you’re staying overnight, allergies, your team and any accessibility needs';
  const privacy = 'Dietary notes, allergies, accessibility needs and emergency contacts are deleted 30 days after the event.';

  // 264 px keeps the white card inside a 390 px phone screen; the PNG is 600 px, so it stays sharp.
  const html = emailPage(new URL(input.passUrl).origin, 'You’re in!', [
    p(`Hi ${e.first},`),
    p(`You're in for <strong>${e.event}</strong>.`, HEADLINE),
    details([['When', e.when], ['Where', e.venue]]),
    qr('<img src="cid:qr" width="264" height="264" alt="Your check-in QR code" style="display:block;width:264px;height:264px;background:#ffffff;border:0">'),
    button(e.url, 'Open your pass'),
    p(`<strong>Next: set up your profile.</strong> Tell us ${setupWhat}.`),
    button(e.profile, 'Set up your profile', 'secondary'),
    list([
      link(escapeHtml(DISCORD_URL), 'Join the Discord'),
      link(escapeHtml(HACKER_PACKAGE_URL), 'Read the hacker package'),
      `${link(escapeHtml(GOOGLE_GROUP_URL), 'Join the Google Group')} for announcements`,
    ]),
  ].join('\n'), `We use your details only to run ${e.event}: admission, meals, attendance and emergencies. ${privacy}`);

  const text = [
    `Hi ${input.firstName},`,
    '',
    `You're in for ${input.event.name}.`,
    '',
    `When: ${when}`,
    `Where: ${input.event.venue}`,
    '',
    `Open your pass (shows your QR code): ${input.passUrl}`,
    '',
    `Next: set up your profile. Tell us ${setupWhat}: ${input.profileUrl}`,
    '',
    `Join the Discord: ${DISCORD_URL}`,
    `Read the hacker package: ${HACKER_PACKAGE_URL}`,
    `Join the Google Group for announcements: ${GOOGLE_GROUP_URL}`,
    '',
    SIGN_OFF_TEXT,
    '',
    `We use your details only to run ${input.event.name}: admission, meals, attendance and emergencies. ${privacy}`,
  ].join('\n');

  return {
    subject: `You're in: ${input.event.name} — your check-in pass`,
    html,
    text,
    inlineImages: [{ cid: 'qr', filename: 'station-qr.png', contentType: 'image/png', content: input.qrPng }],
  };
}

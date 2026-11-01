import { formatEventDateTime } from '@/lib/domain/event-time';
import { escapeHtml } from '@/lib/domain/html';
import { DISCORD_URL, GOOGLE_GROUP_URL, HACKER_PACKAGE_URL, venueMapUrl } from '../links';
import type { InlineImage } from '../provider';
import { button, details, emailPage, HEADLINE, link, p, qr, SIGN_OFF_TEXT, smallLinks } from './layout';

export interface PassEmailInput {
  firstName: string;
  event: { name: string; venue: string; startsAt: string; timezone: string };
  passUrl: string;
  qrPng: Buffer;
  /** v0.9: /me/profile, where they finish setting up (F14); the email links its guided walkthrough (`?setup=1`). */
  profileUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  inlineImages: InlineImage[];
}

// SPEC §12. Body order (v0.11.28, owner's request): greeting, event, local time, venue, the event's links as small
// icon buttons, the arrival note, the QR (it links to the pass; no separate button), then profile setup; privacy line. The QR is an inline cid: attachment, never a data: URI.
export function renderPassEmail(input: PassEmailInput): RenderedEmail {
  const when = formatEventDateTime(input.event.startsAt, input.event.timezone);
  // The guided walkthrough, not the tabs: one tab saved left people unsure what was still missing.
  const setup = new URL(input.profileUrl);
  setup.searchParams.set('setup', '1');
  const profileUrl = setup.toString();
  const mapUrl = venueMapUrl(input.event.venue);
  const e = {
    first: escapeHtml(input.firstName),
    event: escapeHtml(input.event.name),
    when: escapeHtml(when),
    venue: escapeHtml(input.event.venue),
    url: escapeHtml(input.passUrl),
    profile: escapeHtml(profileUrl),
  };
  const setupWhat = 'your emergency contact, whether you’re staying overnight, allergies, your team and any accessibility needs';
  const privacy = 'Dietary notes, allergies, accessibility needs and emergency contacts are deleted 30 days after the event.';
  const arrive = 'Spots are first-come, first-served, limited to the first 175 hackers, so make sure to arrive on time!';
  const origin = new URL(input.passUrl).origin;
  const icon = (name: string) => escapeHtml(`${origin}/email-icon-${name}.png`);

  // 264 px keeps the white card inside a 390 px phone screen; the PNG is 600 px, so it stays sharp.
  const html = emailPage(origin, 'You’re in!', [
    p(`Hi ${e.first},`),
    p(`You're in for <strong>${e.event}</strong>.`, HEADLINE),
    details([['When', e.when], ['Where', mapUrl ? link(escapeHtml(mapUrl), e.venue) : e.venue]]),
    smallLinks([
      [escapeHtml(DISCORD_URL), 'Discord', icon('discord')],
      [escapeHtml(HACKER_PACKAGE_URL), 'Hacker package', icon('book')],
      [escapeHtml(GOOGLE_GROUP_URL), 'Google Group', icon('megaphone')],
    ]),
    p(`<strong>${arrive}</strong>`, 'margin:12px 0 16px;text-align:center'),
    qr(`<a href="${e.url}" style="display:block"><img src="cid:qr" width="264" height="264" alt="Your check-in QR code (opens your pass)" style="display:block;width:264px;height:264px;background:#ffffff;border:0"></a>`),
    p(`<strong>Next: set up your profile.</strong> Tell us ${setupWhat}.`, 'margin:24px 0 16px'),
    button(e.profile, 'Set up your profile', 'secondary'),
  ].join('\n'), `We use your details only to run ${e.event}: admission, meals, attendance and emergencies. ${privacy}`);

  const text = [
    `Hi ${input.firstName},`,
    '',
    `You're in for ${input.event.name}.`,
    '',
    `When: ${when}`,
    `Where: ${input.event.venue}${mapUrl ? `: ${mapUrl}` : ''}`,
    '',
    `Open your pass (shows your QR code): ${input.passUrl}`,
    '',
    `Next: set up your profile. Tell us ${setupWhat}: ${profileUrl}`,
    '',
    `Join the Discord: ${DISCORD_URL}`,
    `Read the hacker package: ${HACKER_PACKAGE_URL}`,
    `Join the Google Group for announcements: ${GOOGLE_GROUP_URL}`,
    '',
    arrive,
    '',
    SIGN_OFF_TEXT,
    '',
    `We use your details only to run ${input.event.name}: admission, meals, attendance and emergencies. ${privacy}`,
  ].join('\n');

  return {
    subject: `You're in: your check-in pass for ${input.event.name}`,
    html,
    text,
    inlineImages: [{ cid: 'qr', filename: 'station-qr.png', contentType: 'image/png', content: input.qrPng }],
  };
}

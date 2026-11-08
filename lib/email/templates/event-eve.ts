import { escapeHtml } from '@/lib/domain/html';
import { DISCORD_URL, HACKER_PACKAGE_URL, venueMapUrl } from '../links';
import type { RenderedEmail } from './pass';
import { button, details, emailPage, HEADLINE, link, list, p, SIGN_OFF_TEXT } from './layout';

export interface EventEveEmailInput {
  firstName: string;
  /** The email name of the event, e.g. "Sheridan Datathon 2026" (emailEventName()). */
  event: string;
  appOrigin: string;
}

// Owner's request (2026-11-06): the day before the event, to accepted hackers only, in the owner's words.
// shortcut: this event's check-in time and room are written here, not read from the event; move them to the events
// table (or the Info page) if another event sends this email.
const CHECK_IN = 'Saturday, November 7, 9:00 to 10:45 AM';
const ROOM = '1st Floor Atrium, Building C';
const CAMPUS = 'Sheridan College, Hazel McCallion Campus, 4180 Duke of York Blvd, Mississauga';
const BRING = [
  'Your laptop and charger lol',
  'Extension cords / power bars (outlets are often limited, so please bring one if you can!)',
  'Any adapters, cables, or hardware you plan to use!',
  'A water bottle, plus a blanket or pillow if you’re staying overnight',
  'Hygiene products (deodorant!!)',
  'Anything else you might need for an overnight 24 hours :)',
];

export function renderEventEveEmail(input: EventEveEmailInput): RenderedEmail {
  const event = escapeHtml(input.event);
  const mapUrl = venueMapUrl('HMC Campus');
  const html = emailPage(input.appOrigin, 'See you tomorrow!', [
    p(`Hi ${escapeHtml(input.firstName)},`),
    p(`<strong>${event}</strong> is tomorrow, and we can’t wait to see you!`, HEADLINE),
    details([
      ['Check-in', escapeHtml(CHECK_IN)],
      ['Where', `${escapeHtml(ROOM)}<br>${mapUrl ? link(escapeHtml(mapUrl), escapeHtml(CAMPUS)) : escapeHtml(CAMPUS)}`],
    ]),
    p('<strong>Bring your student ID.</strong> Check-in closes at 10:45 AM, and the opening ceremony starts at 11:00.'),
    p('Make sure you go through the <strong>Hacker Package</strong> before you come! It has the schedule, rules, tracks and everything else you need to know!!'),
    button(escapeHtml(HACKER_PACKAGE_URL), 'Read the Hacker Package'),
    p('<strong>Don’t forget to bring:</strong>', 'margin:8px 0 8px'),
    list(BRING.map(escapeHtml)),
    button(escapeHtml(DISCORD_URL), 'Join the Discord', 'secondary'),
    p('<strong>See you tomorrow!</strong>', 'margin:8px 0 0'),
  ].join('\n'));

  const text = [
    `Hi ${input.firstName},`,
    '',
    `${input.event} is tomorrow, and we can’t wait to see you!`,
    '',
    `Check-in: ${CHECK_IN}, ${ROOM}`,
    `${CAMPUS}${mapUrl ? `: ${mapUrl}` : ''}`,
    'Bring your student ID. Check-in closes at 10:45 AM, and the opening ceremony starts at 11:00.',
    '',
    `Make sure you go through the Hacker Package before you come! It has the schedule, rules, tracks and everything else you need to know!! ${HACKER_PACKAGE_URL}`,
    '',
    'Don’t forget to bring:',
    ...BRING.map((b) => `- ${b}`),
    '',
    `Join our Discord for all live updates during the event: ${DISCORD_URL}`,
    '',
    'See you tomorrow!',
    '',
    SIGN_OFF_TEXT,
  ].join('\n');

  return { subject: `${input.event} is tomorrow: check-in details`, html, text, inlineImages: [] };
}

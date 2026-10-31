import { formatEventDateTime } from '@/lib/domain/event-time';
import { escapeHtml } from '@/lib/domain/html';
import type { RenderedEmail } from './pass';
import { button, details, emailPage, HEADLINE, MUTED, p, SIGN_OFF_TEXT } from './layout';

export interface StaffAddedEmailInput {
  /** Their staff display name, if they have set one. */
  name: string | null;
  role: 'organizer' | 'volunteer';
  event: { name: string; startsAt: string; timezone: string };
  slug: string;
  appOrigin: string;
}

// SPEC F9 step 1 / §12 (v0.11.12): someone who already has an account was added as staff, so the auth server sends
// nothing. No token: the link opens the sign-in page, which goes on to their scanner or admin pages.
export function renderStaffAddedEmail(input: StaffAddedEmailInput): RenderedEmail {
  const organizer = input.role === 'organizer';
  const url = `${input.appOrigin}/login?next=/${organizer ? 'admin' : 'scan'}/${input.slug}`;
  const as = organizer ? 'an organizer' : 'a volunteer';
  const opens = organizer ? 'the admin pages and the scanner' : 'the scanner';
  const when = formatEventDateTime(input.event.startsAt, input.event.timezone);
  const hint = 'Never set a password? Use “Forgot or never set your password?” on the sign-in page.';
  const hi = input.name ? `Hi ${input.name},` : 'Hi,';
  const html = emailPage(input.appOrigin, 'Staff access', [
    p(escapeHtml(hi)),
    p(`You’re now ${as} for <strong>${escapeHtml(input.event.name)}</strong>.`, HEADLINE),
    details([['When', escapeHtml(when)], ['Access', opens]]),
    p(`Sign in with your Datathon password to open ${opens}.`),
    button(escapeHtml(url), 'Sign in'),
    p(escapeHtml(hint), MUTED),
  ].join('\n'), `An organizer of ${escapeHtml(input.event.name)} added you to its staff.`);
  const text = [
    hi,
    '',
    `You’re now ${as} for ${input.event.name}.`,
    `When: ${when}`,
    '',
    `Sign in with your Datathon password to open ${opens}.`,
    `Sign in: ${url}`,
    '',
    hint,
    '',
    SIGN_OFF_TEXT,
  ].join('\n');
  return { subject: `You’re now ${as} for ${input.event.name}`, html, text, inlineImages: [] };
}

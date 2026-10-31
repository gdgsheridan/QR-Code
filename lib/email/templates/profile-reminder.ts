import { escapeHtml } from '@/lib/domain/html';
import type { RenderedEmail } from './pass';
import { button, emailPage, HEADLINE, MUTED, p, SIGN_OFF_TEXT } from './layout';

export interface ProfileReminderEmailInput {
  firstName: string;
  event: string;
  appOrigin: string;
}

// SPEC F14 / §12 (v0.9): two days before the event, to accepted hackers who haven't finished their profile.
// No token: the link opens their signed-in menu.
export function renderProfileReminderEmail(input: ProfileReminderEmailInput): RenderedEmail {
  const url = `${input.appOrigin}/me/profile`;
  const ask = "Your emergency contact, whether you're staying overnight, allergies, your team and any accessibility needs. It takes a minute.";
  const html = emailPage(input.appOrigin, 'Finish your profile', [
    p(`Hi ${escapeHtml(input.firstName)},`),
    p(`Please finish setting up your profile before <strong>${escapeHtml(input.event)}</strong>.`, HEADLINE),
    p(escapeHtml(ask), MUTED),
    button(escapeHtml(url), 'Set up your profile'),
  ].join('\n'));
  const text = [`Hi ${input.firstName},`, '', `Please finish setting up your profile before ${input.event}.`, '', ask, '', `Set up your profile: ${url}`, '', SIGN_OFF_TEXT].join('\n');
  return { subject: `Finish setting up your profile for ${input.event}`, html, text, inlineImages: [] };
}

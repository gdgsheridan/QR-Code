import { escapeHtml } from '@/lib/domain/html';
import type { RenderedEmail } from './pass';
import { button, emailPage, HEADLINE, p, SIGN_OFF_TEXT } from './layout';

export interface TeamInviteEmailInput {
  firstName: string;
  inviter: string;
  team: string;
  event: string;
  appOrigin: string;
}

// SPEC F15 / §12 (S11b): consent happens on the Team page; no join code or token travels in email.
export function renderTeamInviteEmail(input: TeamInviteEmailInput): RenderedEmail {
  const url = `${input.appOrigin}/me/team`;
  const sentence = `${input.inviter} invited you to join ${input.team} at ${input.event}`;
  const html = emailPage(input.appOrigin, 'Team invite', [
    p(`Hi ${escapeHtml(input.firstName)},`),
    p(`${escapeHtml(sentence)}.`, HEADLINE),
    button(escapeHtml(url), 'Open your Team page'),
  ].join('\n'));
  const text = [`Hi ${input.firstName},`, '', `${sentence}.`, '', `Open your Team page: ${url}`, '', SIGN_OFF_TEXT].join('\n');
  return { subject: sentence, html, text, inlineImages: [] };
}

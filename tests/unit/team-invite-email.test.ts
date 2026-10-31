import { expect, it } from 'vitest';
import { renderTeamInviteEmail } from '@/lib/email/templates/team-invite';

it('T-TEAM-06: invite email escapes names, links only to Team, has text and stays under 60 KB', () => {
  const origin = 'https://station.example.test';
  const email = renderTeamInviteEmail({ firstName: '<b>x</b>', inviter: '<b>x</b>', team: '<b>x</b>', event: '<b>x</b>', appOrigin: origin });
  expect(email.subject).toBe('<b>x</b> invited you to join <b>x</b> at <b>x</b>');
  expect(email.html).not.toContain('<b>x</b>');
  expect(email.html.match(/&lt;b&gt;x&lt;\/b&gt;/g)).toHaveLength(4);
  expect(email.html).toContain(`href="${origin}/me/team"`);
  expect(email.html.match(/href=/g)).toHaveLength(1);
  expect(email.text).toContain(`${origin}/me/team`);
  expect(email.text).toContain('<b>x</b> invited you to join <b>x</b> at <b>x</b>');
  expect(email.html + email.text).not.toMatch(/[A-HJ-NP-Z2-9]{8}|\/p#|\/rsvp#|join.code/i);
  expect(Buffer.byteLength(email.html)).toBeLessThan(60 * 1024);
});

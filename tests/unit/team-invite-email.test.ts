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

it('T-TEAM-06 (v0.11.25): several pending invites make one email that counts them', () => {
  const email = renderTeamInviteEmail({ firstName: 'Ada', inviter: 'Ben', team: 'Byte Club', event: 'Datathon', appOrigin: 'https://s.test', count: 3 });
  expect(email.subject).toBe('3 teams invited you to join them at Datathon');
  expect(email.text).toContain('3 teams invited you to join them at Datathon.');
  expect(email.html).toContain('href="https://s.test/me/team"');
});

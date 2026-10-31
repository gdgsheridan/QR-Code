import { expect, it } from 'vitest';
import { renderStaffAddedEmail } from '@/lib/email/templates/staff-added';

it('T-AUTH-03 (U): the staff-added email escapes names, has one Sign in link to the role’s page, text, and stays under 60 KB', () => {
  const origin = 'https://station.example.test';
  const event = { name: '<b>x</b>', startsAt: '2026-11-07T14:00:00Z', timezone: 'America/Toronto' };
  const vol = renderStaffAddedEmail({ name: '<b>x</b>', role: 'volunteer', event, slug: 'datathon-2026', appOrigin: origin });
  expect(vol.subject).toBe('You’re now a volunteer for <b>x</b>');
  expect(vol.html).not.toContain('<b>x</b>');
  expect(vol.html.match(/&lt;b&gt;x&lt;\/b&gt;/g)?.length).toBeGreaterThanOrEqual(2);
  expect(vol.html).toContain(`href="${origin}/login?next=/scan/datathon-2026"`);
  expect(vol.html.match(/href=/g)).toHaveLength(1);
  expect(vol.html).toContain('>Staff access<'); // the hero title (v0.11.20 design)
  expect(vol.html).toContain('Sat, Nov 7 · 9:00 AM EST');
  expect(vol.text).toContain(`Sign in: ${origin}/login?next=/scan/datathon-2026`);
  expect(vol.text).toContain('Hi <b>x</b>,');
  expect(vol.text).toContain('Forgot or never set your password?');
  expect(vol.html + vol.text).not.toMatch(/\/p#|\/rsvp#|#[A-Za-z0-9_-]{20,}/);
  expect(Buffer.byteLength(vol.html)).toBeLessThan(60 * 1024);

  const org = renderStaffAddedEmail({ name: null, role: 'organizer', event, slug: 'datathon-2026', appOrigin: origin });
  expect(org.subject).toBe('You’re now an organizer for <b>x</b>');
  expect(org.html).toContain(`href="${origin}/login?next=/admin/datathon-2026"`);
  expect(org.text.startsWith('Hi,\n')).toBe(true);
});

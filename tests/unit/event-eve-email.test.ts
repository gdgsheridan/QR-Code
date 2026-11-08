import { expect, it } from 'vitest';
import { DISCORD_URL, HACKER_PACKAGE_URL } from '@/lib/email/links';
import { renderEventEveEmail } from '@/lib/email/templates/event-eve';

// Owner's request (2026-11-06): the day-before email to accepted hackers. Proposed SPEC ID T-MAIL-17 (§12, §14.4).
it('T-MAIL-17: the event-eve email has the check-in facts, the package and Discord links, text, and escapes names', () => {
  const origin = 'https://station.example.test';
  const email = renderEventEveEmail({ firstName: '<b>x</b>', event: 'Sheridan Datathon 2026', appOrigin: origin });
  expect(email.subject).toBe('Sheridan Datathon 2026 is tomorrow: check-in details');
  expect(email.html).not.toContain('<b>x</b>');
  expect(email.html).toContain('Hi &lt;b&gt;x&lt;/b&gt;,');
  for (const part of [email.html, email.text]) {
    expect(part).toContain('Saturday, November 7, 9:00 to 10:45 AM');
    expect(part).toContain('1st Floor Atrium, Building C');
    expect(part).toContain('4180 Duke of York Blvd, Mississauga');
    expect(part).toContain('Check-in closes at 10:45 AM, and the opening ceremony starts at 11:00.');
    expect(part).toContain('deodorant!!');
  }
  expect(email.html).toContain(`href="${HACKER_PACKAGE_URL.replace(/&/g, '&amp;')}"`);
  expect(email.html).toContain(`href="${DISCORD_URL}"`);
  expect(email.text).toContain(HACKER_PACKAGE_URL);
  expect(email.text).toContain(DISCORD_URL);
  expect(email.text).toContain('Hi <b>x</b>,');
  expect(email.html + email.text).not.toMatch(/\/p#|\/rsvp#/); // no pass or RSVP token
  expect(email.inlineImages).toEqual([]);
  expect(Buffer.byteLength(email.html)).toBeLessThan(60 * 1024);
});

import { describe, expect, it } from 'vitest';
import { venueMapUrl } from '@/lib/email/links';
import { renderPassEmail } from '@/lib/email/templates/pass';
import { renderRsvpEmail } from '@/lib/email/templates/rsvp';

const mapUrl = 'https://www.google.com/maps/search/?api=1&query=4180%20Duke%20of%20York%20Blvd%2C%20Mississauga%2C%20ON%20L5B%200H7';
const escapedMapUrl = mapUrl.replace('&', '&amp;');
const base = {
  firstName: 'Ada',
  event: { name: 'Datathon', venue: 'HMC Campus', startsAt: '2026-11-07T14:00:00Z', timezone: 'America/Toronto' },
  passUrl: 'https://station.example.com/p#test-token',
  profileUrl: 'https://station.example.com/me/profile',
  qrPng: Buffer.from('fake-png'),
  rsvpUrl: 'https://station.example.com/rsvp#test-token',
  closesAt: null,
};

it('T-MAIL-07: venue mapping trims and ignores case, leaving other venues unmapped', () => {
  expect(venueMapUrl('HMC Campus')).toBe(mapUrl);
  expect(venueMapUrl('  hMc cAmPuS\n')).toBe(mapUrl);
  expect(venueMapUrl('Another campus')).toBeNull();
  expect(venueMapUrl('')).toBeNull();
});

describe.each([
  ['pass', renderPassEmail],
  ['RSVP', renderRsvpEmail],
  ['RSVP reminder', (input: typeof base) => renderRsvpEmail({ ...input, reminder: true })],
] as const)('%s venue', (_name, render) => {
  it('T-MAIL-07: links HMC Campus in HTML and text, with HTML under 60 KB', () => {
    const email = render(base);
    expect(email.html).toContain(`<a href="${escapedMapUrl}" style="color:#b8dcff;text-decoration:underline">HMC Campus</a>`);
    expect(email.text).toContain(`Where: HMC Campus: ${mapUrl}`);
    expect(Buffer.byteLength(email.html, 'utf8')).toBeLessThan(60 * 1024);
  });

  it('T-MAIL-07: leaves another venue as plain text', () => {
    const email = render({ ...base, event: { ...base.event, venue: 'Another campus' } });
    expect(email.html).toMatch(/Where:<\/span> Another campus<\/p>/);
    expect(email.text.split('\n')).toContain('Where: Another campus');
    expect(email.html).not.toContain('google.com/maps');
    expect(email.text).not.toContain('google.com/maps');
  });

  it('T-MAIL-08: escapes HTML characters in an unmapped venue', () => {
    const venue = '<b>HMC Campus</b> & "Hall"';
    const email = render({ ...base, event: { ...base.event, venue } });
    expect(email.html).toContain('&lt;b&gt;HMC Campus&lt;/b&gt; &amp; &quot;Hall&quot;');
    expect(email.html).not.toContain(venue);
    expect(email.html).not.toContain('google.com/maps');
    expect(email.text.split('\n')).toContain(`Where: ${venue}`);
  });
});

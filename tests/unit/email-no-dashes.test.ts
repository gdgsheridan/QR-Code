import { describe, expect, it } from 'vitest';
import { formalVenue } from '@/lib/email/links';
import { renderPassEmail } from '@/lib/email/templates/pass';
import { renderProfileReminderEmail } from '@/lib/email/templates/profile-reminder';
import { renderRsvpEmail } from '@/lib/email/templates/rsvp';
import { renderStaffAddedEmail } from '@/lib/email/templates/staff-added';
import { renderTeamInviteEmail } from '@/lib/email/templates/team-invite';

const origin = 'https://station.example.com';
const event = { name: 'Sheridan Datathon 2026', venue: formalVenue('HMC Campus'), startsAt: '2026-11-07T14:00:00Z', timezone: 'America/Toronto' };
const rsvp = { firstName: 'Ada', event, rsvpUrl: `${origin}/rsvp#Ab3_-xYz0123456789abcdefGHIJKLMN`, closesAt: '2026-11-08T04:59:00Z' };

const emails = {
  pass: renderPassEmail({ firstName: 'Ada', event, passUrl: `${origin}/p#Ab3_-xYz0123456789abcdefGHIJKLMN`, qrPng: Buffer.from('png'), profileUrl: `${origin}/me/profile` }),
  rsvp: renderRsvpEmail(rsvp),
  rsvpReplyBy: renderRsvpEmail({ ...rsvp, replyBy: '2026-11-04T04:59:00Z' }),
  rsvpReminder: renderRsvpEmail({ ...rsvp, replyBy: '2026-11-04T04:59:00Z', reminder: true }),
  profileReminder: renderProfileReminderEmail({ firstName: 'Ada', event: event.name, appOrigin: origin }),
  teamInvite: renderTeamInviteEmail({ firstName: 'Ada', inviter: 'Ben', team: 'Byte Me', event: event.name, appOrigin: origin }),
  teamInvites: renderTeamInviteEmail({ firstName: 'Ada', inviter: 'Ben', team: 'Byte Me', event: event.name, appOrigin: origin, count: 3 }),
  organizer: renderStaffAddedEmail({ name: 'Maya', role: 'organizer', event, slug: 'dashboard', appOrigin: origin }),
  volunteer: renderStaffAddedEmail({ name: null, role: 'volunteer', event, slug: 'dashboard', appOrigin: origin }),
};

describe('email wording (SPEC §12)', () => {
  it.each(Object.entries(emails))('T-MAIL-07: the %s email has no em or en dash in its subject, HTML or text (owner’s request)', (_, m) => {
    for (const part of [m.subject, m.html, m.text]) expect(part).not.toMatch(/[–—]/);
  });
});

import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Database } from '@/lib/db/types.gen';
import { drainOutbox } from '@/lib/email/drain';
import type { EmailMessage } from '@/lib/email/provider';
import { renderRsvpEmail } from '@/lib/email/templates/rsvp';
import { emailEventName } from '@/lib/email/links';
import { earlierReplyBy, shownReplyBy } from '@/lib/domain/rsvp';

const base = {
  firstName: 'Ada',
  event: { name: 'Datathon', venue: 'HMC Campus', startsAt: '2026-11-07T14:00:00Z', timezone: 'America/Toronto' },
  rsvpUrl: 'https://station.example.com/rsvp#Ab3_-xYz0123456789abcdefGHIJKLMN',
  closesAt: '2026-11-04T04:59:00Z', // Nov 3, 11:59 PM EST
};

describe('RSVP email (SPEC §12, F13 v0.9)', () => {
  it('T-RSVP-11: shows the reply-by time in the event timezone and what no reply means', () => {
    const m = renderRsvpEmail(base);
    expect(m.subject).toBe("You're invited: Datathon");
    for (const part of [m.html, m.text]) {
      expect(part).toContain('Tue, Nov 3 · 11:59 PM EST');
      expect(part).toContain('No reply by then counts as a no');
      expect(part).toContain(base.rsvpUrl);
    }
  });

  it('T-RSVP-13: the reply-by date is shown while it is ahead; past it (a late invite) or unset, the real close (v0.11.28)', () => {
    const now = new Date('2026-11-01T12:00:00Z');
    const replyBy = '2026-11-04T04:59:00.000Z'; // Tue, Nov 3, 11:59 PM EST
    const closes = '2026-11-08T04:59:00.000Z'; // Sat, Nov 7, 11:59 PM EST
    expect(shownReplyBy(replyBy, closes, now)).toBe(replyBy);
    expect(shownReplyBy(replyBy, closes, new Date('2026-11-05T12:00:00Z'))).toBe(closes);
    expect(shownReplyBy(null, closes, now)).toBe(closes);
    expect(shownReplyBy(null, null, now)).toBeNull();
    expect(earlierReplyBy(replyBy, closes, now)).toBe(replyBy);
    expect(earlierReplyBy(replyBy, closes, new Date('2026-11-05T12:00:00Z'))).toBeNull();
    expect(earlierReplyBy(replyBy, replyBy, now)).toBeNull(); // the same moment: just the close
    expect(earlierReplyBy(null, closes, now)).toBeNull();
    expect(earlierReplyBy(replyBy, null, now)).toBe(replyBy);
  });

  it('T-RSVP-13: an earlier reply-by date is asked for, and the email names the real close as when no reply counts as a no', () => {
    const replyBy = '2026-11-04T04:59:00.000Z';
    const m = renderRsvpEmail({ ...base, closesAt: '2026-11-08T04:59:00.000Z', replyBy });
    for (const part of [m.html, m.text]) {
      expect(part).toContain('Please reply by Tue, Nov 3 · 11:59 PM EST.');
      expect(part).toContain('Invitations close Sat, Nov 7 · 11:59 PM EST; no reply by then counts as a no, and your spot goes to someone on the waitlist.');
    }
    const reminder = renderRsvpEmail({ ...base, closesAt: '2026-11-08T04:59:00.000Z', replyBy, reminder: true, now: new Date('2026-11-02T17:00:00Z') });
    expect(reminder.subject).toBe('Reminder: Datathon starts in 5 days'); // v0.11.49: the countdown, the reply-by date in the body
    expect(reminder.text).toContain('Please reply by Tue, Nov 3 · 11:59 PM EST.');
    // A reply-by date with no deadline: asked for, but nothing ever counts as a no.
    const soft = renderRsvpEmail({ ...base, closesAt: null, replyBy });
    for (const part of [soft.html, soft.text]) {
      expect(part).toContain('Please reply by Tue, Nov 3 · 11:59 PM EST.');
      expect(part).not.toContain('counts as a no');
      expect(part).not.toContain('Invitations close');
    }
    // No reply-by date: today's single sentence with the close.
    expect(renderRsvpEmail(base).text).not.toContain('Invitations close');
  });

  it('T-RSVP-11: emails give the datathon its full name (v0.11.23); other events keep theirs', () => {
    expect(emailEventName('dashboard', 'Datathon')).toBe('Sheridan Datathon 2026');
    expect(emailEventName('hack-day', 'Hack Day')).toBe('Hack Day');
  });

  it('T-RSVP-11: a reminder counts the days to the event in its timezone (v0.11.49); no deadline, no deadline line; names are escaped', () => {
    const at = (now: string) => renderRsvpEmail({ ...base, reminder: true, now: new Date(now) });
    expect(at('2026-11-03T17:00:00Z').subject).toBe('Reminder: Datathon starts in 4 days');
    expect(at('2026-11-04T03:00:00Z').subject).toBe('Reminder: Datathon starts in 4 days'); // 10 PM Nov 3 in Toronto, Nov 4 in UTC
    expect(at('2026-10-31T16:00:00Z').subject).toBe('Reminder: Datathon starts in 7 days'); // across the DST change
    expect(at('2026-11-06T22:00:00Z').subject).toBe('Reminder: Datathon starts tomorrow');
    expect(at('2026-11-07T12:00:00Z').subject).toBe('Reminder: Datathon starts today');
    expect(at('2026-11-08T12:00:00Z').subject).toBe("Reminder: you're invited to Datathon");
    expect(at('2026-11-03T17:00:00Z').text).toContain("A reminder: you're invited to Datathon, which starts in 4 days, and we haven't heard back yet.");
    // The HTML headline ends in the count, set large on its own line.
    const big = (now: string) => /Datathon (starts(?: in)?)<\/p>\s*<p style="[^"]*60px[^"]*">([^<]+)<\/p>/.exec(at(now).html)?.slice(1);
    expect(big('2026-11-03T17:00:00Z')).toEqual(['starts in', '4 days']);
    expect(big('2026-11-06T22:00:00Z')).toEqual(['starts', 'tomorrow']);
    expect(big('2026-11-07T12:00:00Z')).toEqual(['starts', 'today']);
    expect(at('2026-11-03T17:00:00Z').html).toContain("You're invited, and we haven't heard back from you yet. Will you be there?");
    expect(at('2026-11-08T12:00:00Z').html).not.toContain('font-size:60px'); // after the start: the plain reminder line
    expect(at('2026-11-08T12:00:00Z').html).toContain("A reminder: you're invited to <strong>Datathon</strong>, and we haven't heard back yet.");
    expect(renderRsvpEmail({ ...base, now: new Date('2026-11-03T17:00:00Z') }).html).not.toContain('font-size:60px'); // the invitation has none
    expect(at('2026-11-08T12:00:00Z').text).toContain("A reminder: you're invited to Datathon, and we haven't heard back yet.");
    const open = renderRsvpEmail({ ...base, closesAt: null });
    expect(open.text).not.toContain('Reply by');
    expect(open.text).not.toContain('counts as a no');
    const odd = renderRsvpEmail({ ...base, firstName: '<b>x</b>', event: { ...base.event, name: 'A & "B"' } });
    expect(odd.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(odd.html).toContain('A &amp; &quot;B&quot;');
  });

  it('T-RSVP-11: the drainer cancels a kind it doesn\'t know instead of issuing a pass', async () => {
    const calls: Array<{ fn: string; args: unknown }> = [];
    const row = { id: 'o1', participant_id: 'p1', kind: 'mystery', attempts: 1, claim_token: 'c1' };
    const participant = { first_name: 'Ada', email: 'ada@example.test', status: 'accepted', deleted_at: null, events: { ...base.event, starts_at: base.event.startsAt } };
    const fake = {
      rpc: async (fn: string, args: unknown) => {
        calls.push({ fn, args });
        return { data: fn === 'claim_outbox' ? [row] : null, error: null };
      },
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: participant, error: null }) }) }) }),
    };
    const sent: EmailMessage[] = [];
    const result = await drainOutbox({
      db: fake as unknown as SupabaseClient<Database>,
      provider: { name: 'mock', send: async (m) => (sent.push(m), { id: 'x' }) },
      appOrigin: 'https://station.example.com',
      from: 'Station <p@example.test>',
      passSecret: 'x'.repeat(32),
    });
    expect(result).toMatchObject({ claimed: 1, cancelled: 1, sent: 0 });
    expect(calls.map((c) => c.fn)).toEqual(['claim_outbox', 'finish_outbox']);
    expect(calls[1]?.args).toEqual({ p_id: 'o1', p_status: 'cancelled', p_claim_token: 'c1' });
    expect(sent).toEqual([]);
  });
});

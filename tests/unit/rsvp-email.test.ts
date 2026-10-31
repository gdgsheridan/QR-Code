import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Database } from '@/lib/db/types.gen';
import { drainOutbox } from '@/lib/email/drain';
import type { EmailMessage } from '@/lib/email/provider';
import { renderRsvpEmail } from '@/lib/email/templates/rsvp';

const base = {
  firstName: 'Ada',
  event: { name: 'Datathon', venue: 'HMC Campus', startsAt: '2026-11-07T14:00:00Z', timezone: 'America/Toronto' },
  rsvpUrl: 'https://station.example.com/rsvp#Ab3_-xYz0123456789abcdefGHIJKLMN',
  closesAt: '2026-11-04T04:59:00Z', // Nov 3, 11:59 PM EST
};

describe('RSVP email (SPEC §12, F13 v0.9)', () => {
  it('T-RSVP-11: shows the reply-by time in the event timezone and what no reply means', () => {
    const m = renderRsvpEmail(base);
    expect(m.subject).toBe("You're invited: Datathon — will you be there?");
    for (const part of [m.html, m.text]) {
      expect(part).toContain('Tue, Nov 3 · 11:59 PM EST');
      expect(part).toContain('No reply by then counts as a no');
      expect(part).toContain(base.rsvpUrl);
    }
  });

  it('T-RSVP-11: a reminder says so in the subject; no deadline, no deadline line; names are escaped', () => {
    expect(renderRsvpEmail({ ...base, reminder: true }).subject).toBe('Reminder: reply by Tue, Nov 3 — Datathon');
    const open = renderRsvpEmail({ ...base, closesAt: null });
    expect(open.text).not.toContain('Reply by');
    expect(open.text).not.toContain('counts as a no');
    const odd = renderRsvpEmail({ ...base, firstName: '<b>x</b>', event: { ...base.event, name: 'A & "B"' } });
    expect(odd.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(odd.html).toContain('A &amp; &quot;B&quot;');
  });

  it('T-RSVP-11: the drainer cancels a kind it doesn\'t know instead of issuing a pass', async () => {
    const calls: Array<{ fn: string; args: unknown }> = [];
    const row = { id: 'o1', participant_id: 'p1', kind: 'mystery', attempts: 1 };
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
    expect(calls[1]?.args).toEqual({ p_id: 'o1', p_status: 'cancelled' });
    expect(sent).toEqual([]);
  });
});

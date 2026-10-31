import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drainUntilIdle } from '@/lib/email/drain';
import { generateToken, sha256hex } from '@/lib/domain/token';
import { createRsvpHandler } from '@/lib/rsvp/handlers';
import { requireEnv } from '../fixtures/db';
import { mockProvider, rsvpTokenFromEmail, sentTo, serviceClient } from '../fixtures/mail';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC F13 (v0.9): the RSVP deadline, auto-"no" and reminders. run_rsvp_jobs() looks at every event with a
// deadline, so assertions only look at this file's own people (never global counts).
let f: StandardFixture;
const events: Record<'open' | 'past' | 'ended' | 'race', string> = { open: '', past: '', ended: '', race: '' };
// 23:59 local, `days` ahead: like Nov 3, 11:59 PM ET for an event on Nov 7.
const ahead = (days: number) => `((((now() at time zone 'America/Toronto')::date + ${days}) + time '23:59') at time zone 'America/Toronto')`;
const addEvent = async (key: keyof typeof events, startsIn: string, endsIn: string, deadline: string) => {
  const { rows } = await f.pool.query<{ id: string }>(
    `insert into events (slug, name, venue, starts_at, ends_at, rsvp_deadline)
     values ($1, $2, 'Hall', now() + $3::interval, now() + $4::interval, ${deadline}) returning id`,
    [`${f.slug}-${key}`, `Deadline ${key}`, startsIn, endsIn],
  );
  events[key] = rows[0]?.id ?? '';
};
beforeAll(async () => {
  f = await createStandardFixture({ poolSize: 60 });
  await addEvent('open', '20 days', '21 days', ahead(10));
  await addEvent('past', '5 days', '6 days', `now() - interval '2 days'`);
  await addEvent('ended', '-3 days', '-1 day', `now() - interval '5 days'`);
});
afterAll(async () => {
  await f.close();
});

let n = 0;
async function invitee(eventId: string, opts: { sentAgo?: string | null; status?: string } = {}): Promise<{ id: string; email: string; token: string }> {
  const email = `inv${n++}-${f.slug}@example.test`;
  const token = generateToken();
  const { rows } = await f.pool.query<{ id: string }>(
    `insert into participants (event_id, email, first_name, search_text, status, source, rsvp_token_hash, rsvp_sent_at)
     values ($1, $2, 'Rae', 'rae', $3, 'sheet', $4, now() - $5::interval) returning id`,
    [eventId, email, opts.status ?? 'pending', sha256hex(token), opts.sentAgo === undefined ? '3 days' : opts.sentAgo],
  );
  return { id: rows[0]?.id ?? '', email, token };
}
// The local time `time` on the day `dayOffset` days from the event's deadline day, as an instant.
async function localAt(eventId: string, dayOffset: number, time: string): Promise<string> {
  const { rows } = await f.pool.query<{ at: Date }>(
    `select ((((rsvp_deadline at time zone timezone)::date + $2::int) + $3::time) at time zone timezone) as at from events where id = $1`,
    [eventId, dayOffset, time],
  );
  return (rows[0]?.at ?? new Date(0)).toISOString();
}
const jobs = async (at: string | null = null) =>
  (await f.pool.query<{ r: { expired: number; reminded: number } }>('select run_rsvp_jobs(coalesce($1::timestamptz, now())) as r', [at])).rows[0]?.r;
const outbox = async (id: string) =>
  (await f.pool.query<{ kind: string; status: string }>('select kind, status from email_outbox where participant_id = $1 order by created_at', [id])).rows;
const row = async (id: string) =>
  (await f.pool.query<{ status: string; rsvp_sent_at: Date | null }>('select status, rsvp_sent_at from participants where id = $1', [id])).rows[0];
const respond = async (token: string, going: boolean) =>
  (await f.pool.query<{ code: string }>('select rsvp_respond($1, $2) as code', [sha256hex(token), going])).rows[0]?.code;

const anon = () =>
  createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'), { auth: { persistSession: false } });
const handler = createRsvpHandler({
  db: serviceClient(),
  scheduleDrain: () => undefined,
  drain: async () => undefined,
  signIn: async (email, password) => (!(await anon().auth.signInWithPassword({ email, password })).error ? { next: '/me' } : 'wrong'),
});
let ip = 0;
const call = async (body: unknown) => {
  const res = await handler(
    new Request('http://localhost/api/rsvp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.8.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}` },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const YES = { going: true, emergencyName: 'Sam Lee', emergencyPhone: '416 555 0100', password: 'rae-event-password' };
const hasAccount = async (email: string) =>
  ((await f.pool.query<{ n: number }>('select count(*)::int as n from auth.users where lower(email) = $1', [email])).rows[0]?.n ?? 0) > 0;

describe('RSVP deadline (SPEC F13, v0.9)', () => {
  it('T-RSVP-08: an invite closes at the later of the deadline and 48 h after it was sent; Yes after that is refused before any account exists', async () => {
    const deadline = (await f.pool.query<{ d: Date }>('select rsvp_deadline as d from events where id = $1', [events.past])).rows[0]?.d;
    const late = await invitee(events.past, { sentAgo: '1 hour' });
    const expired = await invitee(events.past, { sentAgo: '10 days' }); // its 48 h ended long before the deadline
    const accepted = await invitee(events.past, { status: 'accepted' });
    const noDeadline = await invitee(f.e1.id, { sentAgo: '30 days' });

    const look = await call({ token: expired.token });
    expect(look).toMatchObject({ status: 200, body: { closed: true, closesAt: deadline?.toISOString() } });
    expect(await call({ token: expired.token, ...YES })).toEqual({ status: 409, body: { error: 'closed' } });
    expect(await hasAccount(expired.email)).toBe(false);
    expect(await row(expired.id)).toMatchObject({ status: 'pending' });
    expect(await outbox(expired.id)).toEqual([]);
    // The answer itself is refused too (a deadline crossed between the lookup and the answer).
    expect(await respond(expired.token, true)).toBe('CLOSED');
    expect(await row(expired.id)).toMatchObject({ status: 'pending' });
    // No still frees the spot.
    expect(await respond(expired.token, false)).toBe('NOT_GOING');
    expect(await row(expired.id)).toMatchObject({ status: 'withdrawn' });

    const lateLook = await call({ token: late.token });
    expect(lateLook.body.closed).toBe(false);
    const sentAt = (await row(late.id))?.rsvp_sent_at;
    expect(Date.parse(String(lateLook.body.closesAt))).toBe((sentAt?.getTime() ?? 0) + 48 * 3600_000);
    expect((await call({ token: late.token, ...YES })).body).toMatchObject({ code: 'GOING' });

    // Accepted people keep "No, give my spot away".
    expect((await call({ token: accepted.token })).body).toMatchObject({ closed: false, status: 'accepted' });
    // No deadline: never closes.
    expect((await call({ token: noDeadline.token })).body).toMatchObject({ closed: false, closesAt: null });
  });

  it('T-RSVP-09: run_rsvp_jobs() turns a missed deadline into a no, once, and leaves everyone else alone', async () => {
    const missed = await invitee(events.past);
    await f.pool.query(`insert into email_outbox (participant_id, kind) values ($1, 'rsvp_reminder')`, [missed.id]);
    const notInvited = await invitee(events.past, { sentAgo: null });
    const accepted = await invitee(events.past, { status: 'accepted' });
    const late = await invitee(events.past, { sentAgo: '1 hour' });
    const resent = await invitee(events.past);
    await f.pool.query(`insert into email_outbox (participant_id, kind) values ($1, 'rsvp')`, [resent.id]);
    const over = await invitee(events.ended);

    await jobs();
    expect(await row(missed.id)).toMatchObject({ status: 'withdrawn' });
    expect(await outbox(missed.id)).toEqual([{ kind: 'rsvp_reminder', status: 'cancelled' }]);
    for (const p of [notInvited, late, resent, over]) expect(await row(p.id), p.email).toMatchObject({ status: 'pending' });
    expect(await row(accepted.id)).toMatchObject({ status: 'accepted' });
    expect(await outbox(resent.id)).toEqual([{ kind: 'rsvp', status: 'pending' }]);

    const audit = async () =>
      (await f.pool.query<{ actor_kind: string; detail: unknown }>(`select actor_kind, detail from audit_log where action = 'rsvp.expire' and subject_id = $1`, [missed.id])).rows;
    expect(await audit()).toEqual([{ actor_kind: 'system', detail: {} }]);
    await jobs();
    expect(await audit()).toHaveLength(1);
    // Their link still opens, to say the deadline passed.
    expect((await call({ token: missed.token })).body).toMatchObject({ status: 'withdrawn', closed: true });
    await f.pool.query(`update email_outbox set status = 'cancelled' where participant_id = $1`, [resent.id]);
  });

  it('T-RSVP-10: reminders go out at 10:00 local on the three days ending on the deadline day, once each, with a new link', async () => {
    const ev = events.open;
    const r1 = await invitee(ev, { sentAgo: '1 day' });
    const yes = await invitee(ev, { sentAgo: '1 day' });
    const accepted = await invitee(ev, { status: 'accepted' });
    const notInvited = await invitee(ev, { sentAgo: null });
    const first = await localAt(ev, -2, '10:00');
    // Invited two hours before the first reminder: too soon for one.
    const fresh = await invitee(ev, { sentAgo: '0 seconds' });
    await f.pool.query(`update participants set rsvp_sent_at = $2::timestamptz - interval '2 hours' where id = $1`, [fresh.id, first]);
    const reminders = async (id: string) => (await outbox(id)).filter((o) => o.kind === 'rsvp_reminder');

    await jobs(await localAt(ev, -2, '09:59'));
    for (const p of [r1, yes, accepted, notInvited, fresh]) expect(await reminders(p.id)).toEqual([]);
    await jobs(first);
    expect(await reminders(r1.id)).toEqual([{ kind: 'rsvp_reminder', status: 'pending' }]);
    expect(await reminders(yes.id)).toHaveLength(1);
    for (const p of [accepted, notInvited, fresh]) expect(await reminders(p.id)).toEqual([]);
    await jobs(await localAt(ev, -2, '10:05'));
    expect(await reminders(r1.id)).toHaveLength(1);

    // Yes with a reminder in flight cancels it and still queues the pass.
    expect(await respond(yes.token, true)).toBe('GOING');
    expect(await outbox(yes.id)).toEqual([
      { kind: 'rsvp_reminder', status: 'cancelled' },
      { kind: 'pass_issued', status: 'pending' },
    ]);

    const sentAt = (await row(r1.id))?.rsvp_sent_at;
    const mail = mockProvider();
    await drainUntilIdle({ db: serviceClient(), provider: mail.provider, appOrigin: 'http://localhost:3100', from: 'Station <p@localhost>', passSecret: requireEnv('PASS_TOKEN_SECRET') });
    const [reminder] = sentTo(mail.sent, r1.email);
    if (!reminder) throw new Error('no reminder email');
    expect(reminder.subject).toMatch(/^Reminder: reply by .+ — Deadline open$/);
    expect(reminder.text).toContain('11:59 PM');
    const newToken = rsvpTokenFromEmail(reminder);
    expect((await call({ token: newToken })).status).toBe(200);
    expect((await call({ token: r1.token })).status).toBe(404);
    expect((await row(r1.id))?.rsvp_sent_at).toEqual(sentAt); // a reminder never extends the 48 h

    await jobs(await localAt(ev, -1, '10:00'));
    expect(await reminders(r1.id)).toHaveLength(2);
    expect(await reminders(fresh.id)).toHaveLength(1);
    expect(await reminders(yes.id)).toHaveLength(1);
    await f.pool.query(`update email_outbox set status = 'cancelled' where participant_id = any($1) and status = 'pending'`, [[r1.id, fresh.id]]);
    // More than 6 h late on the deadline day: skipped, not sent late.
    await jobs(await localAt(ev, 0, '17:00'));
    expect(await reminders(r1.id)).toHaveLength(2);
  });

  it('T-RSVP-10: Nov 1, 2026 (the day DST ends in Toronto): the reminder goes at 10:00 EST, not EDT, and not 6 h late', async () => {
    const { rows } = await f.pool.query<{ id: string }>(
      `insert into events (slug, name, venue, starts_at, ends_at, rsvp_deadline)
       values ($1, 'DST Fest', 'Hall', '2026-11-07T14:00Z', '2026-11-08T22:00Z', '2026-11-04T04:59Z') returning id`,
      [`${f.slug}-dst`],
    );
    const ev = rows[0]?.id ?? '';
    const p = await invitee(ev);
    await f.pool.query(`update participants set rsvp_sent_at = '2026-10-20T15:00Z' where id = $1`, [p.id]);
    const reminders = async () => (await outbox(p.id)).filter((o) => o.kind === 'rsvp_reminder').length;
    await jobs('2026-11-01T14:00:00Z'); // 10:00 EDT: an hour early
    expect(await reminders()).toBe(0);
    await jobs('2026-11-01T21:00:00Z'); // 16:00 EST: 6 h late, skipped
    expect(await reminders()).toBe(0);
    await jobs('2026-11-01T15:00:00Z'); // 10:00 EST
    expect(await reminders()).toBe(1);
    await f.pool.query(`update email_outbox set status = 'cancelled' where participant_id = $1`, [p.id]);
    await f.pool.query(`update events set rsvp_deadline = null where id = $1`, [ev]); // out of later runs' way
  });

  it('T-RSVP-10: an organizer\'s RSVP replaces a reminder still waiting, so the re-send goes out', async () => {
    const p = await invitee(events.open, { sentAgo: '2 days' });
    await f.pool.query(`insert into email_outbox (participant_id, kind) values ($1, 'rsvp_reminder')`, [p.id]);
    const { rows } = await f.pool.query<{ n: number }>('select queue_rsvps($1, $2, $3) as n', [events.open, [p.id], f.staff.org1]);
    expect(rows[0]?.n).toBe(1);
    expect(await outbox(p.id)).toEqual([
      { kind: 'rsvp_reminder', status: 'cancelled' },
      { kind: 'rsvp', status: 'pending' },
    ]);
    await f.pool.query(`update email_outbox set status = 'cancelled' where participant_id = $1 and status = 'pending'`, [p.id]);
  });

  it('T-RSVP-10: a reminder still unsent hours later (an email outage) is dropped, not sent late', async () => {
    const p = await invitee(events.open, { sentAgo: '2 days' });
    await f.pool.query(`insert into email_outbox (participant_id, kind, created_at) values ($1, 'rsvp_reminder', now() - interval '7 hours')`, [p.id]);
    const mail = mockProvider();
    await drainUntilIdle({ db: serviceClient(), provider: mail.provider, appOrigin: 'http://localhost:3100', from: 'Station <p@localhost>', passSecret: requireEnv('PASS_TOKEN_SECRET') });
    expect(sentTo(mail.sent, p.email)).toEqual([]);
    expect(await outbox(p.id)).toEqual([{ kind: 'rsvp_reminder', status: 'cancelled' }]);
    expect((await call({ token: p.token })).status).toBe(200); // their link still works
  });

  it('T-RSVP-10: an organizer\'s Resend is never blocked by a reminder in flight', async () => {
    await f.pool.query(`insert into email_outbox (participant_id, kind) values ($1, 'profile_reminder')`, [f.p.A]);
    const { rows } = await f.pool.query<{ r: string }>('select enqueue_pass($1, $2, $3) as r', [f.e1.id, f.p.A, f.staff.org1]);
    expect(rows[0]?.r).toBe('QUEUED');
    expect((await outbox(f.p.A)).map((o) => `${o.kind}:${o.status}`)).toEqual(expect.arrayContaining(['profile_reminder:cancelled', 'pass_reissued:pending']));
    await f.pool.query(`update email_outbox set status = 'cancelled' where participant_id = $1 and status = 'pending'`, [f.p.A]);
  });

  it('T-RSVP-12: at 10:00 local two days before the event, accepted hackers who haven\'t finished their profile get one reminder', async () => {
    const { rows } = await f.pool.query<{ id: string }>(
      `insert into events (slug, name, venue, starts_at, ends_at) values ($1, 'Profile Fest', 'Hall', '2026-11-07T14:00Z', '2026-11-08T22:00Z') returning id`,
      [`${f.slug}-prof`],
    );
    const ev = rows[0]?.id ?? '';
    const unfinished = await invitee(ev, { status: 'accepted' });
    const later = await invitee(ev, { status: 'accepted' });
    const done = await invitee(ev, { status: 'accepted' });
    await f.pool.query(
      `update participants set emergency_name = 'Sam', emergency_phone = '416 555 0100', overnight = 'no', team_status = 'solo' where id = $1`,
      [done.id],
    );
    const pending = await invitee(ev);
    const profileReminders = async (id: string) => (await outbox(id)).filter((o) => o.kind === 'profile_reminder');

    await jobs('2026-11-05T14:59:00Z'); // 09:59 EST
    for (const p of [unfinished, later, done, pending]) expect(await profileReminders(p.id)).toEqual([]);
    await jobs('2026-11-05T15:00:00Z');
    await jobs('2026-11-05T15:30:00Z');
    expect(await profileReminders(unfinished.id)).toEqual([{ kind: 'profile_reminder', status: 'pending' }]);
    expect(await profileReminders(later.id)).toHaveLength(1);
    for (const p of [done, pending]) expect(await profileReminders(p.id)).toEqual([]);

    // Finished in the meantime: not sent.
    await f.pool.query(
      `update participants set emergency_name = 'Sam', emergency_phone = '416 555 0100', overnight = 'no', team_status = 'solo' where id = $1`,
      [later.id],
    );
    const mail = mockProvider();
    await drainUntilIdle({ db: serviceClient(), provider: mail.provider, appOrigin: 'http://localhost:3100', from: 'Station <p@localhost>', passSecret: requireEnv('PASS_TOKEN_SECRET') });
    const [sent] = sentTo(mail.sent, unfinished.email);
    expect(sent?.subject).toBe('Finish setting up your profile for Profile Fest');
    expect(sent?.text).toContain('http://localhost:3100/me/profile');
    expect(sent?.text).not.toMatch(/#/); // no token
    expect(sentTo(mail.sent, later.email)).toEqual([]);
    expect(await profileReminders(later.id)).toEqual([{ kind: 'profile_reminder', status: 'cancelled' }]);
  });

  it('T-RSVP-12: a reminder waiting in the outbox never swallows a pass, e.g. after a Sheet email change', async () => {
    for (const status of ['pending', 'sending']) {
      const p = await invitee(f.e1.id, { status: 'accepted' });
      await f.pool.query(`update participants set external_id = $2 where id = $1`, [p.id, `sheet-${p.id}`]);
      await f.pool.query(`insert into email_outbox (participant_id, kind, status) values ($1, 'profile_reminder', $2)`, [p.id, status]);
      const { rows } = await f.pool.query<{ r: string }>(
        `select ingest_sheet_row($1, $2, $3, 'Rae', '', 'rae') as r`,
        [f.e1.id, `sheet-${p.id}`, `moved-${p.email}`],
      );
      expect(rows[0]?.r, status).toBe('PASS_QUEUED');
      expect(await outbox(p.id), status).toEqual([
        { kind: 'profile_reminder', status: 'cancelled' },
        { kind: 'pass_reissued', status: 'pending' },
      ]);
      await f.pool.query(`update email_outbox set status = 'cancelled' where participant_id = $1 and status = 'pending'`, [p.id]);
    }
  });

  it('T-CONC-08: reminders, answers and RSVP sends racing never deadlock, and every Yes gets its pass email', async () => {
    // Made here, so no earlier test's run has used up its reminder day.
    await addEvent('race', '40 days', '41 days', ahead(30));
    const ev = events.race;
    const people = await Promise.all(Array.from({ length: 20 }, () => invitee(ev, { sentAgo: '2 days' })));
    const due = await localAt(ev, -2, '10:00');
    const ids = people.map((p) => p.id);
    const tasks: Array<Promise<unknown>> = [
      ...[0, 1, 2].map(() => f.pool.query('select run_rsvp_jobs($1)', [due])),
      ...people.map((p, i) => f.pool.query('select rsvp_respond($1, $2)', [sha256hex(p.token), i % 2 === 0])),
      f.pool.query('select queue_rsvps($1, $2, $3)', [ev, ids, f.staff.org1]),
    ];
    const results = await Promise.allSettled(tasks);
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    const reminded = (await f.pool.query<{ n: number }>(`select count(*)::int as n from email_outbox where participant_id = any($1) and kind = 'rsvp_reminder'`, [ids])).rows[0]?.n;
    expect(reminded).toBeGreaterThan(0); // the reminders really raced too
    for (const [i, p] of people.entries()) {
      if (i % 2 !== 0) continue;
      expect(await row(p.id)).toMatchObject({ status: 'accepted' });
      expect(await outbox(p.id)).toContainEqual({ kind: 'pass_issued', status: 'pending' });
    }
    await f.pool.query(`update email_outbox set status = 'cancelled' where participant_id = any($1) and status = 'pending'`, [ids]);
  });
});

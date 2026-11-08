import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, connectionState, myConnections } from '@/lib/me/connections';
import { runRetention } from '@/lib/privacy/retention';
import { serviceClient } from '../fixtures/mail';
import { createStandardFixture, randomUid, type StandardFixture } from '../fixtures/standard';

// SPEC F17 (v0.12): the connection game. Tapping someone's badge and pressing Connect counts once both have
// done it (mutual). Only signed-in, checked-in attendees of the badge's event can connect.
let f: StandardFixture;
const db = serviceClient();
beforeAll(async () => {
  f = await createStandardFixture();
});
afterAll(async () => {
  await f.close();
});

const emailOf = async (id: string) => (await f.pool.query<{ email: string }>('select email from participants where id = $1', [id])).rows[0]?.email ?? '';
const as = async (id: string) => ({ id: f.staff.vol1, email: await emailOf(id) }); // any account id: the email is what matches
// A fresh accepted attendee of E1, checked in, with a badge.
const person = async (opts: { checkedIn?: boolean } = {}) => {
  const { id } = await f.addParticipant(f.e1.id);
  if (opts.checkedIn !== false) await f.checkIn(id);
  const { uid } = await f.linkBadge(id);
  return { id, uid, user: await as(id) };
};

describe('record_connection() (SPEC F17)', () => {
  it('T-CONN-01: pending, then mutual once both tapped; repeats; who may connect', async () => {
    const a = await person(), b = await person();
    expect(await connect(db, a.user, b.uid)).toEqual({ code: 'PENDING', firstName: 'Extra' });
    expect(await connectionState(db, a.user, b.uid)).toBe('SENT');
    expect(await connectionState(db, b.user, a.uid)).toBe('RECEIVED');
    expect((await connect(db, a.user, b.uid)).code).toBe('ALREADY_PENDING');
    expect((await connect(db, b.user, a.uid)).code).toBe('MUTUAL');
    expect((await connect(db, b.user, a.uid)).code).toBe('ALREADY_MUTUAL');
    expect((await connect(db, a.user, b.uid)).code).toBe('ALREADY_MUTUAL');
    expect(await connectionState(db, a.user, b.uid)).toBe('MUTUAL');

    expect((await connect(db, a.user, a.uid)).code).toBe('SELF');
    expect(await connectionState(db, a.user, a.uid)).toBe('SELF');
    expect((await connect(db, a.user, randomUid())).code).toBe('NOT_FOUND');
    // Not checked in at the door: can't connect (stops pre-event farming with shared badge links).
    const late = await person({ checkedIn: false });
    expect((await connect(db, late.user, a.uid)).code).toBe('NOT_CHECKED_IN');
    expect(await connectionState(db, late.user, a.uid)).toBe('NOT_CHECKED_IN');
    // Not an attendee of this badge's event: another event's attendee, staff, a waitlisted applicant.
    for (const viewer of [await as(f.p.X), { id: f.staff.org1, email: f.staffEmail.org1 }, await as(f.p.C)]) {
      expect((await connect(db, viewer, a.uid)).code).toBe('NOT_ATTENDEE');
      expect(await connectionState(db, viewer, a.uid)).toBe('NOT_ATTENDEE');
    }
    // Withdrawn badge holder: their badge shows nothing, so nothing to connect to.
    const gone = await person();
    await f.pool.query(`update participants set status = 'withdrawn' where id = $1`, [gone.id]);
    expect((await connect(db, a.user, gone.uid)).code).toBe('NOT_FOUND');
    // Nothing was written by any refusal.
    const { rows } = await f.pool.query('select from_participant_id from connection_taps where event_id = $1 and $2 in (from_participant_id, to_participant_id)', [f.e1.id, late.id]);
    expect(rows).toEqual([]);
  });

  it('T-CONN-01: after the event ends, nobody can connect', async () => {
    const a = await person(), b = await person();
    await f.pool.query(`update events set ends_at = now() - interval '1 minute', starts_at = now() - interval '1 day' where id = $1`, [f.e1.id]);
    try {
      expect((await connect(db, a.user, b.uid)).code).toBe('CLOSED');
      expect(await connectionState(db, a.user, b.uid)).toBe('CLOSED');
    } finally {
      await f.pool.query(`update events set starts_at = now() - interval '1 hour', ends_at = now() + interval '1 day' where id = $1`, [f.e1.id]);
    }
  });

  it('T-CONN-02: two people tapping each other at the same moment get exactly one MUTUAL and one PENDING, every round', async () => {
    // Genuinely parallel: two connections from the fixture's pool, one per tap.
    // 40 rounds, or CONC_ITERATIONS in the nightly loop (T-CONC-07).
    const rounds = Math.max(40, Number(process.env.CONC_ITERATIONS ?? 0));
    for (let round = 0; round < rounds; round++) {
      const a = await person(), b = await person();
      const tap = (from: typeof a, to: typeof a) =>
        f.pool.query<{ r: { code: string } }>('select record_connection($1, $2) as r', [from.user.email, to.uid]).then((x) => x.rows[0]?.r.code);
      const codes = await Promise.all([tap(a, b), tap(b, a)]);
      expect(codes.toSorted(), `round ${round}`).toEqual(['MUTUAL', 'PENDING']);
    }
  });

  it('T-CONN-03: 120 connect presses per account per hour, then RATE_LIMITED with nothing written', async () => {
    const a = await person(), b = await person();
    for (let i = 0; i < 120; i++) expect((await connect(db, a.user, b.uid)).code).toMatch(/PENDING/);
    expect((await connect(db, a.user, (await person()).uid)).code).toBe('RATE_LIMITED');
    const { rows } = await f.pool.query('select count(*)::int as n from connection_taps where from_participant_id = $1', [a.id]);
    expect(rows).toEqual([{ n: 1 }]);
  });
});

describe('my_connections() (SPEC F17)', () => {
  it('T-CONN-04: mutual connections only, newest first, LinkedIn only if shared; the waiting count; tombstoned people drop out', async () => {
    const me = await person();
    const others = [await person(), await person(), await person(), await person(), await person(), await person()];
    for (const o of others) {
      await connect(db, me.user, o.uid);
      await connect(db, o.user, me.uid);
    }
    const waiting = await person();
    await connect(db, me.user, waiting.uid); // I tapped, they haven't yet
    await connect(db, (await person()).user, me.uid); // they tapped, I haven't: not counted for me
    await f.pool.query(`update participants set linkedin_url = 'https://www.linkedin.com/in/shared', profile_public = true where id = $1`, [others[5]?.id]);
    await f.pool.query(`update participants set linkedin_url = 'https://www.linkedin.com/in/private', profile_public = false where id = $1`, [others[4]?.id]);

    const all = await myConnections(db, me.id, 50);
    expect(all.total).toBe(6);
    expect(all.waitingOn).toBe(1);
    expect(all.recent.map((c) => c.badgeUid)).toEqual(others.map((o) => o.uid).toReversed()); // newest first
    expect(all.recent[0]).toEqual({ firstName: 'Extra', lastName: 'Fixture', linkedinUrl: 'https://www.linkedin.com/in/shared', badgeUid: others[5]?.uid, connectedAt: expect.any(String) });
    expect(all.recent[1]?.linkedinUrl).toBeNull();
    expect(JSON.stringify(all)).not.toMatch(/@|private/); // no email, no unshared link
    expect((await myConnections(db, me.id, 5)).recent).toHaveLength(5);

    // The tombstone deletes their taps: they leave my list and count.
    await f.pool.query('select delete_participant($1, $2, $3)', [f.e1.id, others[5]?.id, f.staff.org1]);
    expect((await myConnections(db, me.id, 50)).total).toBe(5);
    const { rows } = await f.pool.query('select 1 from connection_taps where $1 in (from_participant_id, to_participant_id)', [others[5]?.id]);
    expect(rows).toEqual([]);
  });

  it('T-CONN-05: the retention run deletes an event’s connections 30 days after it ends, and only that event’s', async () => {
    const { rows: ev } = await f.pool.query<{ id: string }>(
      `insert into events (slug, name, venue, starts_at, ends_at) values ($1, 'Old Event', 'Hall', now() - interval '40 days', now() - interval '31 days') returning id`,
      [`${f.slug}-conn`],
    );
    const oldEvent = ev[0]?.id ?? '';
    const p1 = await f.addParticipant(oldEvent), p2 = await f.addParticipant(oldEvent);
    await f.pool.query('insert into connection_taps (event_id, from_participant_id, to_participant_id) values ($1, $2, $3), ($1, $3, $2)', [oldEvent, p1.id, p2.id]);
    const a = await person(), b = await person();
    await connect(db, a.user, b.uid);
    const report = await runRetention(db, new Date());
    expect(report.connectionsDeleted).toBeGreaterThanOrEqual(2);
    expect((await f.pool.query('select 1 from connection_taps where event_id = $1', [oldEvent])).rows).toEqual([]);
    expect((await f.pool.query('select 1 from connection_taps where from_participant_id = $1', [a.id])).rows).toHaveLength(1);
    expect((await runRetention(db, new Date())).connectionsDeleted).toBe(0);
  });
});

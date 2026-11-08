import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, obj } from '../fixtures/admin-api';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC §13 (v0.12): the organizer's Workshops tab and the Leaderboard tab's totals. Counts only; the same
// exclusions as every §13 metric (voided, is_test, deleted).
let f: StandardFixture;
let org: string;
let vol: string;
const c = adminClient();
beforeAll(async () => {
  f = await createStandardFixture();
  [org, vol] = [await signInAs(f.staffEmail.org1), await signInAs(f.staffEmail.vol1)];
});
afterAll(async () => {
  await f.close();
});

const workshop = async (name: string, capacity: number | null = null) => {
  const { rows } = await f.pool.query<{ id: string }>(
    `insert into checkpoints (event_id, name, kind, requires_checkin, is_open, capacity) values ($1, $2, 'session', true, true, $3) returning id`,
    [f.e1.id, name, capacity],
  );
  return rows[0]?.id ?? '';
};
// Live workshop scan `minutesAgo` minutes ago (outside the cooldown of the next one).
const attend = async (cp: string, participantId: string, minutesAgo: number) => {
  const r = await f.scan({ cp, staff: f.staff.vol1, participantId });
  expect(r.code).toBe('ACCEPTED');
  await f.pool.query(`update scans set scanned_at = now() - make_interval(mins => $2) where id = $1`, [r.scanId, minutesAgo]);
  return r.scanId ?? '';
};

describe('organizer analytics (§13)', () => {
  it('T-ANA-09: workshops: attendees per workshop, how many each checked-in hacker attended, refusals, 15-minute buckets', async () => {
    const pandas = await workshop(`Pandas ${randomUUID().slice(0, 4)}`, 4);
    const pitch = await workshop(`Pitch ${randomUUID().slice(0, 4)}`);
    const empty = await workshop(`Empty ${randomUUID().slice(0, 4)}`);
    for (const p of [f.p.A, f.p.B, f.p.Rv, f.p.T]) await f.checkIn(p); // T is a test participant
    await attend(pandas, f.p.A, 60);
    await attend(pitch, f.p.A, 30);
    await attend(f.cp.W, f.p.A, 10); // A: 3 workshops
    await attend(pandas, f.p.B, 60); // B: 1
    const voided = await attend(pitch, f.p.Rv, 30);
    await f.voidScan(voided, f.staff.org1, 'Test scan'); // Rv: 0 (voided)
    await attend(pandas, f.p.T, 60); // test: excluded
    expect((await f.scan({ cp: pitch, staff: f.staff.vol1, participantId: f.p.B })).code).toBe('ACCEPTED'); // B now: 2
    // Refused attempts are logged by /api/scan (T-SCAN-31); record_scan() alone doesn't log. A test person's don't count (§13).
    await f.pool.query(
      `insert into scan_attempts (event_id, checkpoint_id, participant_id, result_code) values ($1, $2, $3, 'SESSION_COOLDOWN'), ($1, $2, $4, 'SESSION_COOLDOWN')`,
      [f.e1.id, pandas, f.p.A, f.p.T],
    );

    const res = await c.call('getWorkshopAnalytics', org, { slug: f.slug });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = obj(res.body);
    expect(body).toMatchObject({ checkedIn: 3, attendees: 2, checkIns: 5, cooldownMinutes: 5, cooldownRefusals: 1, distribution: [1, 0, 1, 1] });
    const rows = body.workshops as Array<{ name: string; attendees: number; capacity: number | null; fill: number | null }>;
    expect(rows.map((r) => r.attendees)).toEqual([2, 2, 1, 0]); // most attended first, then by name
    expect(rows.find((r) => r.name.startsWith('Pandas'))).toMatchObject({ attendees: 2, capacity: 4, fill: 0.5 });
    expect(rows.find((r) => r.name.startsWith('Empty'))).toMatchObject({ attendees: 0, fill: null });
    const buckets = body.buckets as Array<{ bucketUtc: string; label: string; count: number }>;
    expect(buckets.reduce((n, b) => n + b.count, 0)).toBe(5);
    expect(buckets.every((b) => /E[SD]T$/.test(b.label))).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/@|Fixture/); // no emails or names
    expect(empty).toBeTruthy();
  });

  it('T-LB-05: connection totals: mutual pairs once, one-way taps waiting, share of checked-in hackers connected, hourly buckets', async () => {
    const tap = (a: string, b: string, minutesAgo: number) =>
      f.pool.query(`insert into connection_taps (event_id, from_participant_id, to_participant_id, created_at) values ($1, $2, $3, now() - make_interval(mins => $4))`, [
        f.e1.id, a, b, minutesAgo,
      ]);
    await tap(f.p.A, f.p.B, 90);
    await tap(f.p.B, f.p.A, 80); // mutual A–B
    await tap(f.p.A, f.p.Rv, 20); // one-way
    await tap(f.p.A, f.p.T, 10);
    await tap(f.p.T, f.p.A, 10); // with a test participant: not counted
    const res = await c.call('getConnectionAnalytics', org, { slug: f.slug });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mutual: 1, waiting: 1, checkedIn: 3, connectedPeople: 2, connectedShare: round(2 / 3) });
    const buckets = obj(res.body).buckets as Array<{ count: number; label: string }>;
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.count).toBe(1);
    expect(JSON.stringify(res.body)).not.toMatch(/@|Fixture|[0-9a-f]{8}-[0-9a-f]{4}/); // counts only
  });

  it('T-ANA-10: organizers only', async () => {
    for (const h of ['getWorkshopAnalytics', 'getConnectionAnalytics'] as const) {
      expect((await c.call(h, vol, { slug: f.slug })).status).toBe(403);
      expect((await c.call(h, null, { slug: f.slug })).status).toBe(401);
    }
    expect((await c.call('exportCsv', vol, { slug: f.slug, kind: 'workshops.csv' })).status).toBe(403);
  });

  it('T-ANA-12: workshops.csv: one row per live workshop check-in, in toCsv form, without test, deleted or voided people or other kinds', async () => {
    const talk = await workshop(`Talk ${randomUUID().slice(0, 4)}`);
    const guarded = await f.addParticipant(f.e1.id);
    await f.pool.query(`update participants set first_name = '=HYPERLINK("http://x")' where id = $1`, [guarded.id]);
    await f.checkIn(guarded.id);
    await attend(talk, guarded.id, 240);
    const gone = await f.addParticipant(f.e1.id);
    await f.checkIn(gone.id);
    await attend(talk, gone.id, 240);
    await f.pool.query('select delete_participant($1, $2, $3)', [f.e1.id, gone.id, f.staff.org1]);

    const res = await c.call('exportCsv', org, { slug: f.slug, kind: 'workshops.csv' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="${f.slug}-workshops.csv"`);
    const text = String(res.body);
    expect(text.startsWith('\uFEFF')).toBe(true);
    const rows = text.replace('\uFEFF', '').split('\r\n').filter(Boolean);
    expect(rows[0]).toBe('"workshop","first_name","last_name","scanned_at_utc","scanned_at_local","method"');
    const body = rows.slice(1);
    expect(body).toHaveLength(6); // A ×3, B ×2 (T-ANA-09) + the guarded name; not T, Rv's voided scan, Deleted
    expect(body.some((r) => r.includes(`"'=HYPERLINK(""http://x"")"`))).toBe(true); // I-13
    expect(text).not.toMatch(/Tess|Deleted|Raffle|Lunch|@/);
    expect(body.every((r) => /· .* E[SD]T","manual"$/.test(r))).toBe(true); // I-8: event timezone
    expect(await f.pool.query('select workshop_attendance($1)', [f.e2.id]).then((x) => x.rows[0]?.workshop_attendance)).toEqual([]);
  });

  it('T-ANA-12: workshops.csv is not cut off at PostgREST\'s 1000-row cap for plain selects', async () => {
    const big = await workshop(`Keynote ${randomUUID().slice(0, 4)}`);
    await f.pool.query(
      `with p as (
         insert into participants (event_id, email, first_name, search_text, status, source)
         select $1, 'cap' || g || '@' || $2 || '.test', 'Cap', 'cap', 'accepted', 'seed' from generate_series(1, 1100) g returning id)
       insert into scans (event_id, participant_id, checkpoint_id, method, scanned_by, client_scan_id)
       select $1, p.id, $3, 'manual', $4, gen_random_uuid() from p`,
      [f.e1.id, f.slug, big, f.staff.vol1],
    );
    const res = await c.call('exportCsv', org, { slug: f.slug, kind: 'workshops.csv' });
    expect(String(res.body).split('\r\n').filter((r) => r.includes('"Keynote'))).toHaveLength(1100);
  });
});

const round = (x: number) => Math.round(x * 10_000) / 10_000;

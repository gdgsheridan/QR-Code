import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateToken } from '@/lib/domain/token';
import { adminClient, obj } from '../fixtures/admin-api';
import { scanApi } from '../fixtures/scan-api';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
let org: string;
const c = adminClient();

// Golden fixture (SPEC T-ANA-01). Every expected number below was worked out by hand from these steps.
beforeAll(async () => {
  f = await createStandardFixture();
  org = await signInAs(f.staffEmail.org1);
  const s = (cp: string, token: string) => f.scan({ cp, staff: f.staff.vol1, token });

  for (const t of [f.token.A, f.token.B, f.token.Rv, f.token.T]) await s(f.cp.D, t); // T is is_test
  for (const t of [f.token.A, f.token.B, f.token.T]) await s(f.cp.L, t);
  await s(f.cp.W, f.token.A);
  // A attends Alpha Talk below too: workshops have a cooldown between check-ins (§8 step 11b), so
  // A's Workshop scan happened 10 minutes earlier. Counts and ranking are unaffected.
  await f.pool.query(`update scans set scanned_at = now() - interval '10 minutes' where participant_id = $1 and checkpoint_id = $2`, [f.p.A, f.cp.W]);
  const bW = await s(f.cp.W, f.token.B);
  await f.voidScan(bW.scanId ?? '', f.staff.org1); // voided: excluded
  for (const t of [f.token.A, f.token.B]) await s(f.cp.R, t);
  const rvR = await s(f.cp.R, f.token.Rv);
  await f.voidScan(rvR.scanId ?? '', f.staff.org1);

  const { rows } = await f.pool.query<{ id: string }>(
    `insert into checkpoints (event_id, name, kind, is_open) values ($1, 'Alpha Talk', 'session', true) returning id`,
    [f.e1.id],
  );
  await s(rows[0]?.id ?? '', f.token.A); // ties Workshop at 1 → ranked by name (T-ANA-06)

  const z = await f.addParticipant(f.e1.id);
  await s(f.cp.D, z.token ?? '');
  await c.call('deleteParticipant', org, { slug: f.slug, id: z.id }, { method: 'DELETE' }); // deleted: excluded

  await f.pool.query(`insert into email_outbox (participant_id, kind) values ($1, 'pass_reissued')`, [f.p.N]);
  // T-ANA-07: A is Vegetarian (fixture); only accepted, real, undeleted hackers count.
  const diet = [[f.p.B, 'Halal'], [f.p.T, 'Vegan'], [f.p.C, 'Kosher'], [f.p.Wd, 'Vegan']] as const;
  for (const [id, note] of diet) await f.pool.query(`update participants set dietary_notes = $2 where id = $1`, [id, note]);
  await f.pool.query(`update participants set allergies = 'Peanuts', allergy_severity = 'severe' where id = any($1)`, [[f.p.A, f.p.T]]);
});
afterAll(async () => {
  await f.close();
});

describe('dashboard analytics (SPEC §13)', () => {
  it('T-ANA-01: every dashboard number equals the hand-computed golden value', async () => {
    const { status, body } = await c.call('dashboard', org, { slug: f.slug });
    expect(status).toBe(200);
    expect(body).toMatchObject({
      accepted: 4, // A, B, Rv, N (T is test, Z deleted, C waitlisted, Wd withdrawn)
      checkedIn: 3, // A, B, Rv
      checkInRate: 0.75,
      noShows: 1, // N
      checkpoints: [
        { name: 'Alpha Talk', kind: 'session', liveScans: 1, capacity: null, fill: null },
        { name: 'Door', kind: 'door', liveScans: 3 },
        { name: 'Lunch', kind: 'meal', liveScans: 2, uptake: 0.6667 },
        { name: 'Raffle', kind: 'custom', liveScans: 2 },
        { name: 'Workshop', kind: 'session', liveScans: 1, capacity: 2, fill: 0.5 },
      ],
      sessionRanking: [
        { name: 'Alpha Talk', liveScans: 1 },
        { name: 'Workshop', liveScans: 1 },
      ],
      arrivals: [{ arrivals: 3 }],
      outbox: { pending: 1, failed: 0 },
      alerts: { notFound: [] },
    });
  });

  it('T-ANA-02: voided scans, is_test and deleted participants are excluded from every metric', async () => {
    const body = obj((await c.call('dashboard', org, { slug: f.slug })).body);
    const byName = Object.fromEntries((body.checkpoints as Array<{ name: string; liveScans: number }>).map((cp) => [cp.name, cp.liveScans]));
    expect(byName.Workshop).toBe(1); // B's voided scan not counted
    expect(byName.Raffle).toBe(2); // Rv's voided scan not counted
    expect(byName.Lunch).toBe(2); // T (is_test) not counted
    expect(byName.Door).toBe(3); // T (is_test) and Z (deleted) not counted
  });

  it('T-ANA-07: Catering lists accepted hackers’ dietary notes and allergies, excluding test, waitlisted, withdrawn and deleted people (v0.11.39)', async () => {
    const { status, body } = await c.call('catering', org, { slug: f.slug });
    expect(status).toBe(200);
    expect(obj(body).hackers).toEqual([
      { name: 'Ada Fixture', dietaryNotes: 'Vegetarian', allergies: 'Peanuts', allergySeverity: 'severe' },
      { name: 'Ben Fixture', dietaryNotes: 'Halal', allergies: null, allergySeverity: null },
      { name: 'Nia Fixture', dietaryNotes: null, allergies: null, allergySeverity: null },
      { name: 'Rae Fixture', dietaryNotes: null, allergies: null, allergySeverity: null },
    ]);
    expect(obj((await c.call('dashboard', org, { slug: f.slug })).body)).not.toHaveProperty('dietary'); // moved to Catering
  });

  it('T-ANA-06: session ranking ties are sorted by name ascending', async () => {
    const body = obj((await c.call('dashboard', org, { slug: f.slug })).body);
    expect((body.sessionRanking as Array<{ name: string }>).map((r) => r.name)).toEqual(['Alpha Talk', 'Workshop']);
  });

  it('T-ADM-07: 30 NOT_FOUND from one volunteer in 5 minutes shows an alert on the dashboard', async () => {
    const api = scanApi();
    const jwt = await signInAs(f.staffEmail.vol2);
    for (let i = 0; i < 30; i++) {
      await api.scan(jwt, { checkpointId: f.cp.D, method: 'qr', token: generateToken() });
    }
    const body = obj((await c.call('dashboard', org, { slug: f.slug })).body);
    expect(obj(body.alerts).notFound).toEqual([{ staffUserId: f.staff.vol2, displayName: 'Vol Two', count: 30 }]);
  });

  it('T-ANA-03: an event across the DST change gets two distinct 01:00 buckets labelled EDT and EST', async () => {
    const slug = `dst-${randomBytes(4).toString('hex')}`;
    const { rows: ev } = await f.pool.query<{ id: string }>(
      `insert into events (slug, name, venue, starts_at, ends_at, timezone)
       values ($1, 'DST Night', 'Hall', '2026-10-31T22:00:00-04:00', '2026-11-01T04:00:00-05:00', 'America/Toronto') returning id`,
      [slug],
    );
    const eventId = ev[0]?.id ?? '';
    await f.pool.query(`insert into event_staff (event_id, user_id, role) values ($1, $2, 'organizer')`, [eventId, f.staff.org1]);
    const { rows: door } = await f.pool.query<{ id: string }>(
      `insert into checkpoints (event_id, name, kind, requires_checkin, is_open) values ($1, 'Door', 'door', false, true) returning id`,
      [eventId],
    );
    // Analytics fixture: scans with explicit server times at 01:05 EDT and 01:05 EST (not a scan decision).
    for (const at of ['2026-11-01T05:05:00Z', '2026-11-01T06:05:00Z']) {
      const p = await f.addParticipant(eventId, { withPass: false });
      await f.pool.query(
        `insert into scans (event_id, participant_id, checkpoint_id, method, scanned_by, scanned_at, client_scan_id)
         values ($1, $2, $3, 'manual', $4, $5, $6)`,
        [eventId, p.id, door[0]?.id, f.staff.org1, at, randomUUID()],
      );
    }
    const body = obj((await c.call('dashboard', org, { slug })).body);
    expect(body.arrivals).toEqual([
      { bucketUtc: '2026-11-01T05:00:00.000Z', label: '1:00 AM EDT', arrivals: 1 },
      { bucketUtc: '2026-11-01T06:00:00.000Z', label: '1:00 AM EST', arrivals: 1 },
    ]);
  });
});

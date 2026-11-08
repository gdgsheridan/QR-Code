import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { myWorkshops } from '@/lib/me/workshops';
import { adminClient, obj } from '../fixtures/admin-api';
import { serviceClient } from '../fixtures/mail';
import { scanApi } from '../fixtures/scan-api';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC §8 step 11b (v0.12): a workshop (session checkpoint) scan within the event's cooldown of the person's
// last live workshop scan elsewhere is refused with SESSION_COOLDOWN. ALREADY_SCANNED (step 10) still wins.
// The hacker's Workshops page lists their live workshop scans (F14 step 8).
let f: StandardFixture;
const db = serviceClient();
const ITERATIONS = Math.max(30, Number(process.env.CONC_ITERATIONS ?? 0));
beforeAll(async () => {
  f = await createStandardFixture({ poolSize: 4 });
});
afterAll(async () => {
  await f.close();
});

const workshop = async (name = `Workshop ${randomUUID().slice(0, 8)}`) => {
  const { rows } = await f.pool.query<{ id: string }>(
    `insert into checkpoints (event_id, name, kind, requires_checkin, is_open) values ($1, $2, 'session', true, true) returning id`,
    [f.e1.id, name],
  );
  return rows[0]?.id ?? '';
};
const hacker = async () => {
  const { id } = await f.addParticipant(f.e1.id);
  await f.checkIn(id);
  return id;
};
const rows = async (participantId: string, checkpointId: string) =>
  (await f.pool.query('select 1 from scans where participant_id = $1 and checkpoint_id = $2', [participantId, checkpointId])).rows.length;
const agoMinutes = (participantId: string, checkpointId: string, minutes: number) =>
  f.pool.query(`update scans set scanned_at = now() - make_interval(mins => $3) where participant_id = $1 and checkpoint_id = $2`, [
    participantId,
    checkpointId,
    minutes,
  ]);

describe('workshop cooldown (SPEC §8 step 11b)', () => {
  it('T-SCAN-31: a second workshop within the cooldown is refused with when it opens; nothing is written', async () => {
    const [w1, w2, a] = [await workshop(), await workshop(), await hacker()];
    const first = await f.scan({ cp: w1, staff: f.staff.vol1, participantId: a });
    expect(first.code).toBe('ACCEPTED');
    const { rows: at } = await f.pool.query<{ t: Date }>('select scanned_at as t from scans where id = $1', [first.scanId]);
    const refused = await f.scan({ cp: w2, staff: f.staff.vol1, participantId: a });
    expect(refused).toMatchObject({ code: 'SESSION_COOLDOWN', cooldownMinutes: 5, participant: { id: a } });
    expect(Date.parse(refused.availableAt ?? '')).toBe((at[0]?.t.getTime() ?? 0) + 5 * 60_000);
    expect(await rows(a, w2)).toBe(0);
  });

  it('T-SCAN-31: ALREADY_SCANNED beats the cooldown; other kinds and other people are unaffected', async () => {
    const [w1, w2, a, b] = [await workshop(), await workshop(), await hacker(), await hacker()];
    expect((await f.scan({ cp: w1, staff: f.staff.vol1, participantId: a })).code).toBe('ACCEPTED');
    expect((await f.scan({ cp: w1, staff: f.staff.vol1, participantId: a })).code).toBe('ALREADY_SCANNED');
    expect((await f.scan({ cp: f.cp.R, staff: f.staff.vol1, participantId: a })).code).toBe('ACCEPTED'); // custom
    expect((await f.scan({ cp: f.cp.L, staff: f.staff.vol1, participantId: a })).code).toBe('ACCEPTED'); // meal
    expect((await f.scan({ cp: w2, staff: f.staff.vol1, participantId: b })).code).toBe('ACCEPTED');
  });

  it('T-SCAN-31: the cooldown ends after the set minutes; voided scans don’t count; 0 turns it off', async () => {
    const [w1, w2, w3, a] = [await workshop(), await workshop(), await workshop(), await hacker()];
    const first = await f.scan({ cp: w1, staff: f.staff.vol1, participantId: a });
    await agoMinutes(a, w1, 5);
    expect((await f.scan({ cp: w2, staff: f.staff.vol1, participantId: a })).code).toBe('ACCEPTED');
    // Void the w2 scan: w3 now only sees w1 (5 minutes ago).
    const { rows: s } = await f.pool.query<{ id: string }>('select id from scans where participant_id = $1 and checkpoint_id = $2', [a, w2]);
    expect((await f.voidScan(s[0]?.id ?? '', f.staff.org1, 'Test scan')).code).toBe('VOIDED');
    expect((await f.scan({ cp: w3, staff: f.staff.vol1, participantId: a })).code).toBe('ACCEPTED');
    expect(first.code).toBe('ACCEPTED');

    const b = await hacker();
    await f.pool.query('update events set session_cooldown_minutes = 0 where id = $1', [f.e1.id]);
    try {
      expect((await f.scan({ cp: w1, staff: f.staff.vol1, participantId: b })).code).toBe('ACCEPTED');
      expect((await f.scan({ cp: w2, staff: f.staff.vol1, participantId: b })).code).toBe('ACCEPTED');
    } finally {
      await f.pool.query('update events set session_cooldown_minutes = 5 where id = $1', [f.e1.id]);
    }
  });

  it('T-SCAN-31: QR and NFC go through the same rule', async () => {
    const [w1, w2] = [await workshop(), await workshop()];
    const { id: a, token } = await f.addParticipant(f.e1.id, { withPass: true });
    await f.checkIn(a);
    const { uid } = await f.linkBadge(a);
    expect((await f.scan({ cp: w1, staff: f.staff.vol1, token: token ?? '' })).code).toBe('ACCEPTED');
    expect((await f.badgeScan({ cp: w2, staff: f.staff.vol1, uid })).code).toBe('SESSION_COOLDOWN');
  });

  it('T-SCAN-31: through POST /api/scan: the response carries when it opens, private fields stay out, and the attempt is logged', async () => {
    const [w1, w2, a] = [await workshop(), await workshop(), await hacker()];
    await f.pool.query(`update participants set dietary_notes = 'Vegan', allergies = 'Peanuts', allergy_severity = 'severe' where id = $1`, [a]);
    const api = scanApi();
    const jwt = await signInAs(f.staffEmail.vol1);
    const scan = (checkpointId: string) => api.scan(jwt, { checkpointId, method: 'manual', participantId: a });
    expect((await scan(w1)).body.code).toBe('ACCEPTED');
    const { status, body } = await scan(w2);
    expect(status).toBe(200);
    expect(body).toMatchObject({ code: 'SESSION_COOLDOWN', cooldownMinutes: 5, serverTime: expect.any(String), availableAt: expect.any(String) });
    expect(Date.parse(String(body.availableAt))).toBeGreaterThan(Date.parse(String(body.serverTime)));
    expect(body.participant).toEqual({ id: a, displayName: expect.any(String), status: 'accepted', dietaryNotes: null }); // §9.1: no notes or allergies on a refusal
    const { rows: logged } = await f.pool.query('select 1 from scan_attempts where checkpoint_id = $1 and participant_id = $2 and result_code = $3', [w2, a, 'SESSION_COOLDOWN']);
    expect(logged).toHaveLength(1);
    expect(await rows(a, w2)).toBe(0);
  });

  it('T-CONC-09: the same person at two workshops at the same moment: exactly one ACCEPTED, one SESSION_COOLDOWN', async () => {
    for (let round = 0; round < ITERATIONS; round++) {
      const [w1, w2, a] = [await workshop(), await workshop(), await hacker()];
      const codes = await Promise.all([
        f.scan({ cp: w1, staff: f.staff.vol1, participantId: a }),
        f.scan({ cp: w2, staff: f.staff.vol2, participantId: a }),
      ]);
      expect(codes.map((c) => c.code).toSorted(), `round ${round}`).toEqual(['ACCEPTED', 'SESSION_COOLDOWN']);
    }
  });
});

describe('my_workshops() (F14 step 8)', () => {
  it('T-WS-01: live workshop scans only, newest first, with the cooldown end while it runs', async () => {
    const [w1, w2, a] = [await workshop('Intro to Pandas'), await workshop('Pitching 101'), await hacker()];
    expect(await myWorkshops(db, a)).toEqual({ cooldownMinutes: 5, availableAt: null, serverTime: expect.any(String), workshops: [] });
    await f.scan({ cp: w1, staff: f.staff.vol1, participantId: a });
    await agoMinutes(a, w1, 30);
    await f.scan({ cp: w2, staff: f.staff.vol1, participantId: a });
    await f.scan({ cp: f.cp.R, staff: f.staff.vol1, participantId: a }); // custom: not a workshop
    const mine = await myWorkshops(db, a);
    expect(mine.workshops.map((w) => w.name)).toEqual(['Pitching 101', 'Intro to Pandas']);
    expect(Date.parse(mine.availableAt ?? '')).toBe(Date.parse(mine.workshops[0]?.scannedAt ?? '') + 5 * 60_000);
    expect(JSON.stringify(mine)).not.toMatch(/@|[0-9a-f]{8}-[0-9a-f]{4}/); // no emails, no ids

    const { rows: s } = await f.pool.query<{ id: string }>('select id from scans where participant_id = $1 and checkpoint_id = $2', [a, w2]);
    await f.voidScan(s[0]?.id ?? '', f.staff.org1, 'Test scan');
    const after = await myWorkshops(db, a);
    expect(after.workshops.map((w) => w.name)).toEqual(['Intro to Pandas']);
    expect(after.availableAt).toBeNull(); // 30 minutes ago: no cooldown
  });
});

describe('cooldown setting (Info page)', () => {
  it('T-WS-04: organizers set 0–120 whole minutes; anything else is 400; volunteers 403; audited without detail', async () => {
    const c = adminClient();
    const [org, vol] = [await signInAs(f.staffEmail.org1), await signInAs(f.staffEmail.vol1)];
    const patch = (who: string, body: unknown) => c.call('updateEvent', who, { slug: f.slug }, { method: 'PATCH', body });
    try {
      expect((await patch(org, { sessionCooldownMinutes: 10 })).status).toBe(200);
      expect(obj((await c.call('getEvent', org, { slug: f.slug })).body).sessionCooldownMinutes).toBe(10);
      for (const bad of [-1, 121, 1.5, '5', null]) expect((await patch(org, { sessionCooldownMinutes: bad })).status, String(bad)).toBe(400);
      expect((await patch(vol, { sessionCooldownMinutes: 0 })).status).toBe(403);
      const { rows } = await f.pool.query<{ detail: unknown }>(`select detail from audit_log where event_id = $1 and action = 'event.info'`, [f.e1.id]);
      expect(rows).toEqual([{ detail: {} }]);
    } finally {
      await f.pool.query('update events set session_cooldown_minutes = 5 where id = $1', [f.e1.id]);
    }
  });
});

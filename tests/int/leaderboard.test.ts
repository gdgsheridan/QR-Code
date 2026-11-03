import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { myRank } from '@/lib/me/connections';
import { adminClient, obj } from '../fixtures/admin-api';
import { serviceClient } from '../fixtures/mail';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC F17 step 6 (v0.12): the connection leaderboard. 1 point per mutual connection, derived from the taps as of
// now or the freeze time (I-22); ties share a rank and whoever reached the score first is listed first.
let f: StandardFixture;
let org: string;
let vol: string;
const c = adminClient();
const db = serviceClient();
beforeAll(async () => {
  f = await createStandardFixture();
  [org, vol] = await Promise.all([signInAs(f.staffEmail.org1), signInAs(f.staffEmail.vol1)]);
});
afterAll(async () => {
  await f.close();
});

// Both directions, the later tap `minutesAgo` minutes ago (the connection's time).
const mutual = (a: string, b: string, minutesAgo: number) =>
  f.pool.query(
    `insert into connection_taps (event_id, from_participant_id, to_participant_id, created_at)
     values ($1, $2, $3, now() - make_interval(mins => $4 + 1)), ($1, $3, $2, now() - make_interval(mins => $4))`,
    [f.e1.id, a, b, minutesAgo],
  );
const board = async () => (await c.call('getLeaderboard', org, { slug: f.slug })).body as {
  frozenAt: string | null;
  rows: Array<{ rank: number; name: string; points: number }>;
};

describe('connection leaderboard (SPEC F17)', () => {
  it('T-LB-01: points per mutual connection; ties share a rank, earlier first; test, deleted and non-mutual left out', async () => {
    const n1 = (await f.addParticipant(f.e1.id)).id, n2 = (await f.addParticipant(f.e1.id)).id;
    await mutual(f.p.A, f.p.B, 50); // A reaches 1 at -50
    await mutual(f.p.B, f.p.N, 40); // B reaches 2 at -40
    await mutual(f.p.A, n1, 30); // A reaches 2 at -30: tied with B, but later
    await mutual(f.p.T, f.p.A, 20); // T is a test participant: worth nothing to anyone
    await f.pool.query('insert into connection_taps (event_id, from_participant_id, to_participant_id) values ($1, $2, $3)', [f.e1.id, n2, f.p.A]); // one-way
    const rows = (await board()).rows;
    expect(rows.slice(0, 2)).toEqual([
      { rank: 1, name: 'Ben F.', points: 2 },
      { rank: 1, name: 'Ada F.', points: 2 },
    ]);
    expect(rows.slice(2).map((r) => r.points)).toEqual([1, 1]); // N and n1, rank 3
    expect(rows.slice(2).every((r) => r.rank === 3)).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/Tess|@|[0-9a-f]{8}-/); // no test person, emails or ids
    expect(await myRank(db, f.p.A)).toEqual({ points: 2, rank: 1 });
    expect(await myRank(db, n2)).toEqual({ points: 0, rank: null });

    await f.pool.query('select delete_participant($1, $2, $3)', [f.e1.id, n1, f.staff.org1]);
    expect((await board()).rows.slice(0, 2)).toEqual([
      { rank: 1, name: 'Ben F.', points: 2 },
      { rank: 2, name: 'Ada F.', points: 1 },
    ]);
  });

  it('T-LB-02: freeze fixes the board at that moment; later connections count again after unfreezing; both audited without detail', async () => {
    const before = (await board()).rows;
    expect((await c.call('freezeLeaderboard', org, { slug: f.slug }, { body: { frozen: true } })).status).toBe(200);
    const frozen = await board();
    expect(frozen.frozenAt).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    await f.pool.query(
      `insert into connection_taps (event_id, from_participant_id, to_participant_id) values ($1, $2, $3), ($1, $3, $2)`,
      [f.e1.id, f.p.B, f.p.Rv],
    );
    expect((await board()).rows).toEqual(before);
    expect((await myRank(db, f.p.B)).points).toBe(2); // as of the freeze too
    expect((await c.call('freezeLeaderboard', org, { slug: f.slug }, { body: { frozen: false } })).status).toBe(200);
    expect((await board()).rows[0]).toEqual({ rank: 1, name: 'Ben F.', points: 3 });
    const { rows } = await f.pool.query<{ action: string; detail: unknown }>(
      `select action, detail from audit_log where event_id = $1 and action like 'leaderboard.%' order by id`,
      [f.e1.id],
    );
    expect(rows).toEqual([
      { action: 'leaderboard.freeze', detail: {} },
      { action: 'leaderboard.unfreeze', detail: {} },
    ]);
  });

  it('T-LB-03: organizers only; strict bodies; top 10 at most', async () => {
    expect((await c.call('getLeaderboard', vol, { slug: f.slug })).status).toBe(403);
    expect((await c.call('freezeLeaderboard', vol, { slug: f.slug }, { body: { frozen: true } })).status).toBe(403);
    expect((await c.call('getLeaderboard', null, { slug: f.slug })).status).toBe(401);
    for (const body of [{}, { frozen: 'yes' }, { frozen: true, extra: 1 }]) {
      expect((await c.call('freezeLeaderboard', org, { slug: f.slug }, { body })).status, JSON.stringify(body)).toBe(400);
    }
    for (let i = 0; i < 12; i++) {
      const x = (await f.addParticipant(f.e1.id)).id, y = (await f.addParticipant(f.e1.id)).id;
      await mutual(x, y, 5);
    }
    const res = await c.call('getLeaderboard', org, { slug: f.slug });
    expect(obj(res.body).rows).toHaveLength(10);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

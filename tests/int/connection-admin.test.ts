import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient } from '../fixtures/admin-api';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// F17 / §11 Leaderboard (v0.12.4, owner's request and decision): an organizer looks up one hacker's connections and
// removes one (both taps).
let f: StandardFixture;
let org: string;
const admin = adminClient();
beforeAll(async () => {
  f = await createStandardFixture();
  org = await signInAs(f.staffEmail.org1);
});
afterAll(async () => {
  await f.close();
});

const tap = (from: string, to: string) =>
  f.pool.query('insert into connection_taps (event_id, from_participant_id, to_participant_id) values ($1, $2, $3)', [f.e1.id, from, to]);
const list = (jwt: string | null, participantId: string) =>
  admin.call('listConnections', jwt, { slug: f.slug }, { query: { participantId } });
const remove = (jwt: string | null, body: unknown) => admin.call('removeConnection', jwt, { slug: f.slug }, { method: 'DELETE', body });

describe('connection admin (F17, v0.12.4)', () => {
  it('T-CONN-07: organizers list a hacker’s taps (mutual first) and remove a pair; volunteers, strangers and other events can’t', async () => {
    await tap(f.p.A, f.p.B);
    await tap(f.p.B, f.p.A);
    await tap(f.p.N, f.p.A);
    const vol = await signInAs(f.staffEmail.vol1);
    expect((await list(vol, f.p.A)).status).toBe(403);
    expect((await list(null, f.p.A)).status).toBe(401);
    expect((await list(org, 'nope')).status).toBe(400);
    expect((await list(org, f.p.X)).status).toBe(404); // another event's hacker

    const { body } = await list(org, f.p.A);
    expect(body).toEqual({ connections: [
      { id: f.p.B, name: 'Ben Fixture', state: 'mutual' },
      expect.objectContaining({ id: f.p.N, state: 'received' }),
    ] });
    expect(JSON.stringify(body)).not.toMatch(/@/); // names only, no emails

    expect((await remove(vol, { a: f.p.A, b: f.p.B })).status).toBe(403);
    expect((await remove(org, { a: f.p.A, b: f.p.A })).status).toBe(400);
    expect((await remove(org, { a: f.p.A, b: f.p.B, extra: 1 })).status).toBe(400);
    expect((await remove(org, { a: f.p.A, b: f.p.B })).body).toEqual({ removed: 2 });
    expect((await remove(org, { a: f.p.A, b: f.p.B })).status).toBe(404);
    expect((await list(org, f.p.A)).body).toEqual({ connections: [expect.objectContaining({ id: f.p.N, state: 'received' })] });
    expect((await list(org, f.p.B)).body).toEqual({ connections: [] });

    const audit = await f.pool.query<{ subject_id: string; detail: unknown }>(`select subject_id, detail from audit_log where event_id = $1 and action = 'connection.remove'`, [f.e1.id]);
    expect(audit.rows).toEqual([{ subject_id: f.p.A, detail: { taps: 2 } }]);
  });
});

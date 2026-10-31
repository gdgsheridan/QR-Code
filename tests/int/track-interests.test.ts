import { afterAll, beforeAll, expect, it } from 'vitest';
import { hackerDirectory } from '@/lib/me/hackers';
import { myEvent } from '@/lib/me/profile';
import { myTeam, setTrackInterests } from '@/lib/me/team';
import { serviceClient } from '../fixtures/mail';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC F15/F16 (v0.11.25): each hacker says which tracks they want to do, as part of finding a team.
let f: StandardFixture;
const db = serviceClient();
beforeAll(async () => { f = await createStandardFixture(); });
afterAll(async () => { await f.close(); });
const emailOf = async (id: string) => (await f.pool.query<{ email: string }>('select email from participants where id = $1', [id])).rows[0]!.email;
const as = async (id: string) => ({ id: f.staff.vol1, email: await emailOf(id) });
const track = async (eventId: string, name: string) =>
  (await f.pool.query<{ id: string }>('insert into tracks (event_id, name) values ($1, $2) returning id', [eventId, name])).rows[0]!.id;

it('T-TEAM-08: own interests only, same-event tracks only, any number, before release; shown and filtered in the directory; cleared by track delete and tombstone', async () => {
  const ai = await track(f.e1.id, 'Best AI'), hw = await track(f.e1.id, 'Best Hardware'), other = await track(f.e2.id, 'Other event track');
  await f.pool.query('update events set tracks_released = false where id = $1', [f.e1.id]);
  const a = await as(f.p.A);
  expect(await setTrackInterests(db, a, f.p.A, [ai, hw])).toBe('SAVED');
  expect(await setTrackInterests(db, a, f.p.A, [other])).toBe('BAD_TRACK');
  expect(await setTrackInterests(db, a, f.p.B, [ai])).toBe('NOT_FOUND'); // someone else's row
  expect(await setTrackInterests(db, a, f.p.A, ['not-a-uuid'])).toBe('BAD_TRACK');
  const me = (await myEvent(db, a.email, new Date()))!;
  expect((await myTeam(db, me)).myTrackIds.toSorted()).toEqual([ai, hw].toSorted());
  expect(await setTrackInterests(db, await as(f.p.B), f.p.B, [hw])).toBe('SAVED');

  const read = (filters: { track?: string; looking?: boolean }) =>
    hackerDirectory(db, me, a.email, { search: '', pace: '', looking: false, ...filters }).then((d) => d.people);
  const ada = (await read({})).find((p) => p.id === f.p.A);
  expect(ada && 'tracks' in ada && ada.tracks).toEqual(['Best AI', 'Best Hardware']);
  expect((await read({ track: ai })).map((p) => p.id)).toEqual([f.p.A]);
  expect((await read({ track: hw })).map((p) => p.id).toSorted()).toEqual([f.p.A, f.p.B].toSorted());
  // Names-only Looking rows never carry interests.
  await f.pool.query('update participants set directory_opt_in = false, looking_for_team = true where id = $1', [f.p.B]);
  expect((await read({ looking: true })).find((p) => p.id === f.p.B)).toEqual({ id: f.p.B, name: 'Ben Fixture' });
  expect((await read({ track: hw })).map((p) => p.id)).toEqual([f.p.A]);

  expect(await setTrackInterests(db, a, f.p.A, [])).toBe('SAVED');
  expect((await myTeam(db, me)).myTrackIds).toEqual([]);
  expect(await setTrackInterests(db, a, f.p.A, [ai])).toBe('SAVED');
  await f.pool.query('delete from tracks where id = $1', [ai]);
  expect((await myTeam(db, me)).myTrackIds).toEqual([]);
  expect(await setTrackInterests(db, a, f.p.A, [hw])).toBe('SAVED');
  await f.pool.query('select delete_participant($1, $2, $3)', [f.e1.id, f.p.A, f.staff.org1]);
  expect((await f.pool.query('select 1 from participant_tracks where participant_id = $1', [f.p.A])).rowCount).toBe(0);
  const audit = (await f.pool.query<{ detail: unknown }>(`select detail from audit_log where action = 'profile.tracks' and subject_id = $1`, [f.p.A])).rows;
  expect(audit.length).toBeGreaterThan(0);
  expect(JSON.stringify(audit)).not.toMatch(/Best|@/);
});

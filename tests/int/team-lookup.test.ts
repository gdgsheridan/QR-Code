import { afterAll, beforeAll, expect, it } from 'vitest';
import { teamLookup } from '@/lib/me/team-lookup';
import { myEvent } from '@/lib/me/profile';
import { serviceClient } from '../fixtures/mail';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
let open: string;
let full: string;
let track: string;
beforeAll(async () => {
  f = await createStandardFixture();
  track = (await f.pool.query<{ id: string }>("insert into tracks(event_id, name) values ($1, 'Hidden track') returning id", [f.e1.id])).rows[0]!.id;
  const team = async (event: string, name: string, code: string) =>
    (await f.pool.query<{ id: string }>('insert into teams(event_id, name, join_code) values ($1, $2, $3) returning id', [event, name, code])).rows[0]!.id;
  open = await team(f.e1.id, 'Zoë Builders', 'ABCDEFGH');
  full = await team(f.e1.id, 'Alpha Full', 'JKLMNPQR');
  const other = await team(f.e2.id, 'Other event', 'ABCDEFGH');
  await f.pool.query('update participants set team_id = $1 where id = $2', [other, f.p.X]);
  await f.pool.query('update teams set track_id = $1 where id = $2', [track, open]);
  await f.pool.query('update participants set team_id = $1, directory_opt_in = (id = $2) where id = any($3)', [open, f.p.A, [f.p.A, f.p.B]]);
  const deleted = await f.addParticipant(f.e1.id);
  await f.pool.query("update participants set team_id = $1, first_name = 'Deleted sentinel', deleted_at = now() where id = $2", [open, deleted.id]);
  for (let n = 0; n < 4; n++) {
    const p = await f.addParticipant(f.e1.id);
    await f.pool.query('update participants set team_id = $1 where id = $2', [full, p.id]);
  }
});
afterAll(async () => { await f.close(); });

async function read(filters: { search?: string; hasRoom?: boolean; track?: string } = {}) {
  const email = (await f.pool.query<{ email: string }>('select email from participants where id = $1', [f.p.A])).rows[0]!.email;
  const me = (await myEvent(serviceClient(), email, new Date()))!;
  return teamLookup(serviceClient(), me, { search: '', hasRoom: false, ...filters });
}

it('T-DIR-07: opted-in names only, private members counted, deleted excluded, counts and spots, own team and viewer', async () => {
  const result = await read();
  expect(result.teams.map((t) => t.name)).toEqual(['Alpha Full', 'Zoë Builders']);
  expect(result.teams.find((t) => t.id === open)).toEqual({
    id: open, name: 'Zoë Builders', count: 2, spots: 2, own: true, track: null,
    members: [{ name: 'Ada Fixture', self: true }], hidden: 1,
  });
  expect(result.teams.find((t) => t.id === full)).toMatchObject({ count: 4, spots: 0, own: false });
  expect(JSON.stringify(result)).not.toMatch(/Ben Fixture|Deleted sentinel|Other event|email|join_code|Hidden track/);
});

it('T-DIR-07: has-room and normalized team name search', async () => {
  expect((await read({ hasRoom: true })).teams.map((t) => t.id)).toEqual([open]);
  expect((await read({ search: '  ZÓE!! builders ' })).teams.map((t) => t.id)).toEqual([open]);
  expect((await read({ search: 'absent' })).teams).toEqual([]);
});

it('T-DIR-07: track names and filtering withheld until release, then event-scoped tracks filter teams', async () => {
  expect((await read({ track })).tracks).toEqual([]);
  expect((await read({ track })).teams).toHaveLength(2);
  await f.pool.query('update events set tracks_released = true where id = $1', [f.e1.id]);
  const released = await read({ track });
  expect(released.tracks).toEqual([{ id: track, name: 'Hidden track' }]);
  expect(released.teams.map((t) => t.id)).toEqual([open]);
  expect(released.teams[0]!.track).toBe('Hidden track');
  expect((await read({ track: f.e2.id })).teams).toEqual([]);
  expect((await read({ track: 'invalid' })).teams).toEqual([]);
});

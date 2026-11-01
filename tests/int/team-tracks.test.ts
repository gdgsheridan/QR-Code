import { afterAll, beforeAll, expect, it } from 'vitest';
import { myEvent } from '@/lib/me/profile';
import { tracksWithTeams } from '@/lib/me/team';
import { serviceClient } from '../fixtures/mail';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
beforeAll(async () => { f = await createStandardFixture(); });
afterAll(async () => { await f.close(); });

it('T-TEAM-09: release gates event-scoped tracks, sorted teams and undeleted member counts, with unassigned teams last', async () => {
  const db = serviceClient();
  const track = async (eventId: string, name: string) => {
    const { rows } = await f.pool.query<{ id: string }>('insert into tracks (event_id, name) values ($1, $2) returning id', [eventId, name]);
    return rows[0]!.id;
  };
  const team = async (eventId: string, name: string, code: string, trackId: string | null) => {
    const { rows } = await f.pool.query<{ id: string }>('insert into teams (event_id, name, join_code, track_id) values ($1, $2, $3, $4) returning id', [eventId, name, code, trackId]);
    return rows[0]!.id;
  };
  const hardware = await track(f.e1.id, 'Hardware');
  const ai = await track(f.e1.id, 'AI');
  const empty = await track(f.e1.id, 'Empty');
  const otherTrack = await track(f.e2.id, 'Other event');
  const z = await team(f.e1.id, 'Zebras', 'ZZZZZZZZ', ai);
  const a = await team(f.e1.id, 'Data Wizards', 'DDDDDDDD', ai);
  const unassigned = await team(f.e1.id, 'Undecided', 'UUUUUUUU', null);
  const otherTeam = await team(f.e2.id, 'Private elsewhere', 'PPPPPPPP', otherTrack);
  await f.pool.query('update participants set team_id = $1 where id = any($2)', [a, [f.p.A, f.p.B]]);
  await f.pool.query('update participants set team_id = $1 where id = $2', [z, f.p.N]);
  await f.pool.query('update participants set team_id = $1 where id = $2', [otherTeam, f.p.X]);
  // Keep a tombstoned row attached to exercise the read filter independently of deletion cleanup.
  const deleted = await f.addParticipant(f.e1.id, { withPass: false });
  await f.pool.query('update participants set team_id = $1, deleted_at = now() where id = $2', [a, deleted.id]);
  const { rows } = await f.pool.query<{ email: string }>('select email from participants where id = $1', [f.p.A]);
  const loadMe = async () => {
    const me = await myEvent(db, rows[0]!.email, new Date());
    expect(me).not.toBeNull();
    return me!;
  };
  expect(await tracksWithTeams(db, await loadMe())).toBeNull();
  await f.pool.query('update events set tracks_released = true where id = $1', [f.e1.id]);
  expect(await tracksWithTeams(db, await loadMe())).toEqual([
    { id: ai, name: 'AI', teams: [{ id: a, name: 'Data Wizards', memberCount: 2 }, { id: z, name: 'Zebras', memberCount: 1 }] },
    { id: empty, name: 'Empty', teams: [] },
    { id: hardware, name: 'Hardware', teams: [] },
    { id: null, name: 'No track yet', teams: [{ id: unassigned, name: 'Undecided', memberCount: 0 }] },
  ]);
  await f.pool.query('delete from teams where id = $1', [unassigned]);
  expect((await tracksWithTeams(db, await loadMe()))?.map((t) => t.name)).toEqual(['AI', 'Empty', 'Hardware']);
});

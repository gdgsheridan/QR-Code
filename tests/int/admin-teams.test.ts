import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, obj } from '../fixtures/admin-api';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC §11 Teams (v0.7): organizers see and fix every team, its members and its track, at any time.
let f: StandardFixture;
let org: string;
const c = adminClient();
beforeAll(async () => {
  f = await createStandardFixture();
  org = await signInAs(f.staffEmail.org1);
});
afterAll(async () => {
  await f.close();
});

type Teams = {
  teamsOpen: boolean;
  tracksReleased: boolean;
  tracks: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; name: string; code: string; trackId: string | null; members: Array<{ id: string; displayName: string; status: string }> }>;
  unassigned: Array<{ id: string; displayName: string; looking: boolean }>;
};
const teams = async () => (await c.call('getTeams', org, { slug: f.slug })).body as Teams;
const setTeam = (id: string, teamId: string | null) => c.call('setParticipantTeam', org, { slug: f.slug, id }, { method: 'PATCH', body: { teamId } });

describe('teams admin (SPEC §11, v0.7)', () => {
  it('T-TEAM-04: switches, tracks, teams and members; a 5th member is refused; nothing crosses events; the tombstone leaves the team', async () => {
    const empty = await teams();
    expect(empty).toMatchObject({ teamsOpen: false, tracksReleased: false, tracks: [], teams: [] });
    // Accepted people without a team: A, B, Rv, T, N (not waitlisted C, withdrawn Wd, or E2's X).
    expect(new Set(empty.unassigned.map((u) => u.id))).toEqual(new Set([f.p.A, f.p.B, f.p.Rv, f.p.T, f.p.N]));

    // Switches go through the event PATCH.
    const sw = await c.call('updateEvent', org, { slug: f.slug }, { method: 'PATCH', body: { teamsOpen: true, tracksReleased: true } });
    expect(sw.body).toEqual({ teamsOpen: true, tracksReleased: true });
    expect(obj((await c.call('getEvent', org, { slug: f.slug })).body)).toMatchObject({ teamsOpen: true, tracksReleased: true });

    // Tracks: one per line, repeats ignored (also against existing ones), renamed, refused when blank or too many.
    expect((await c.call('addTracks', org, { slug: f.slug }, { body: { text: 'Best AI/ML Project\nBest Hardware Project\nbest ai/ml project' } })).status).toBe(201);
    expect((await c.call('addTracks', org, { slug: f.slug }, { body: { text: 'BEST HARDWARE PROJECT\nBest Beginner Project' } })).body).toEqual({ added: 1 });
    expect((await c.call('addTracks', org, { slug: f.slug }, { body: { text: ' \n' } })).status).toBe(400);
    const tracks = (await teams()).tracks;
    expect(tracks.map((t) => t.name)).toEqual(['Best AI/ML Project', 'Best Hardware Project', 'Best Beginner Project']);
    const [ai, hw, beginner] = tracks.map((t) => t.id);
    expect((await c.call('updateTrack', org, { slug: f.slug, id: beginner ?? '' }, { method: 'PATCH', body: { name: 'Best Beginner Hack' } })).status).toBe(200);
    expect((await c.call('updateTrack', org, { slug: f.slug, id: beginner ?? '' }, { method: 'PATCH', body: { name: 'best ai/ml project' } })).status).toBe(409);

    // Teams: created with a join code and a track; names are unique in any case.
    const made = await c.call('createTeam', org, { slug: f.slug }, { body: { name: 'Data Wizards', trackId: ai } });
    expect(made.status).toBe(201);
    const team = obj(obj(made.body).team) as { id: string; code: string };
    expect(team.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect((await c.call('createTeam', org, { slug: f.slug }, { body: { name: 'DATA wizards' } })).status).toBe(409);
    expect((await c.call('createTeam', org, { slug: f.slug }, { body: { name: '' } })).status).toBe(400);
    expect((await c.call('updateTeam', org, { slug: f.slug, id: team.id }, { method: 'PATCH', body: { name: 'Data Wizards 2', trackId: hw } })).status).toBe(200);

    // Members: four fit, a fifth is refused; another event's person or team is not found.
    for (const p of [f.p.A, f.p.B, f.p.Rv, f.p.N]) expect((await setTeam(p, team.id)).status).toBe(200);
    expect((await setTeam(f.p.T, team.id)).status).toBe(409);
    expect((await setTeam(f.p.X, team.id)).status).toBe(404);
    const e2Team = (await f.pool.query<{ id: string }>(`insert into teams (event_id, name, join_code) values ($1, 'Elsewhere', 'ABCDEFGH') returning id`, [f.e2.id])).rows[0]?.id ?? '';
    expect((await setTeam(f.p.T, e2Team)).status).toBe(404);
    expect((await c.call('updateTeam', org, { slug: f.slug, id: e2Team }, { method: 'PATCH', body: { name: 'Mine now' } })).status).toBe(404);

    const full = await teams();
    expect(full.teams).toEqual([
      {
        id: team.id,
        name: 'Data Wizards 2',
        code: team.code,
        trackId: hw,
        members: expect.arrayContaining([expect.objectContaining({ id: f.p.A, displayName: 'Ada Fixture', status: 'accepted' })]) as unknown,
      },
    ]);
    expect(full.teams[0]?.members).toHaveLength(4);
    expect(full.unassigned.map((u) => u.id)).toEqual([f.p.T]);

    // Removing a member frees a place; deleting the track clears it from the team; the tombstone leaves the team.
    expect((await setTeam(f.p.N, null)).status).toBe(200);
    expect((await setTeam(f.p.T, team.id)).status).toBe(200);
    expect((await c.call('deleteTrack', org, { slug: f.slug, id: hw ?? '' }, { method: 'DELETE' })).status).toBe(200);
    expect((await teams()).teams[0]?.trackId).toBeNull();
    await c.call('deleteParticipant', org, { slug: f.slug, id: f.p.Rv }, { method: 'DELETE' });
    expect((await f.pool.query('select team_id from participants where id = $1', [f.p.Rv])).rows).toEqual([{ team_id: null }]);

    // Deleting the team moves its members out.
    expect((await c.call('deleteTeam', org, { slug: f.slug, id: team.id }, { method: 'DELETE' })).status).toBe(200);
    expect((await f.pool.query('select 1 from participants where team_id is not null and event_id = $1', [f.e1.id])).rowCount).toBe(0);
    expect((await c.call('deleteTeam', org, { slug: f.slug, id: team.id }, { method: 'DELETE' })).status).toBe(404);

    // I-11: ids only in the audit trail.
    const { rows } = await f.pool.query<{ detail: unknown }>(`select detail from audit_log where event_id = $1 and (action like 'team.%' or action like 'track.%')`, [f.e1.id]);
    expect(rows.length).toBeGreaterThan(5);
    expect(JSON.stringify(rows)).not.toMatch(new RegExp(`wizards|hardware|${team.code}|@`, 'i'));
  });
  it('T-TEAM-03 (v0.11.25): an organizer deleting a team while its members leave or pick a track never deadlocks', async () => {
    await f.pool.query('update events set teams_open = true, tracks_released = true where id = $1', [f.e1.id]);
    const { rows: [tr] } = await f.pool.query<{ id: string }>(`insert into tracks (event_id, name) values ($1, 'Deadlock track') returning id`, [f.e1.id]);
    const emailOf = async (id: string) => (await f.pool.query<{ email: string }>('select email from participants where id = $1', [id])).rows[0]!.email;
    for (let round = 0; round < 40; round++) {
      const [a, b] = await Promise.all([f.addParticipant(f.e1.id, { withPass: false }), f.addParticipant(f.e1.id, { withPass: false })]);
      const { rows: [team] } = await f.pool.query<{ id: string }>(
        `insert into teams (event_id, name, join_code) values ($1, $2, $3) returning id`, [f.e1.id, `Deadlock ${round}`, `DLK${String(round).padStart(2, '2').replace(/[01]/g, '2')}ZZZ`.slice(0, 8)]);
      await f.pool.query('update participants set team_id = $1 where id = any($2)', [team!.id, [a.id, b.id]]);
      const [del, left, picked] = await Promise.all([
        // What the Teams page's Delete runs (delete_team(), v0.11.25), at database speed so the race is real.
        f.pool.query('select delete_team($1, $2, $3) as r', [f.e1.id, team!.id, f.staff.org1]).then((r) => ({ status: r.rows[0]?.r === 'DELETED' ? 200 : 404 })),
        f.pool.query('select team_leave($1, $2, $3) as r', [a.id, await emailOf(a.id), f.staff.vol1]),
        f.pool.query('select team_set_track($1, $2, $3, $4) as r', [b.id, await emailOf(b.id), f.staff.vol1, tr!.id]),
      ]);
      expect([200, 404], `round ${round}`).toContain(del.status);
      expect(left.rows[0]?.r).toBeDefined();
      expect(picked.rows[0]?.r).toBeDefined();
      expect((await f.pool.query('select 1 from teams where id = $1', [team!.id])).rowCount, `round ${round}`).toBe(0);
    }
  });
});

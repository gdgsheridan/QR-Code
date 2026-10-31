import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTeam, joinTeam, leaveTeam, setTeamTrack } from '@/lib/me/team';
import { serviceClient } from '../fixtures/mail';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC F15 (v0.7): hackers form teams of at most 4 while organizers have forming open, and pick a track once released.
let f: StandardFixture;
beforeAll(async () => {
  f = await createStandardFixture({ poolSize: 24 });
});
afterAll(async () => {
  await f.close();
});

const db = () => serviceClient();
const emailOf = async (id: string) => (await f.pool.query<{ email: string }>('select email from participants where id = $1', [id])).rows[0]?.email ?? '';
const as = async (id: string) => ({ id: f.staff.vol1, email: await emailOf(id) }); // any account id: it only goes into audit_log
const setOpen = (eventId: string, open: boolean) => f.pool.query('update events set teams_open = $2 where id = $1', [eventId, open]);
const teamOf = async (id: string) => (await f.pool.query<{ team_id: string | null }>('select team_id from participants where id = $1', [id])).rows[0]?.team_id ?? null;
const teamRow = async (name: string) =>
  (
    await f.pool.query<{ id: string; join_code: string; track_id: string | null }>('select id, join_code, track_id from teams where name = $1 and event_id = any($2)', [
      name,
      [f.e1.id, f.e2.id],
    ])
  ).rows[0];
const track = async (eventId: string, name: string) =>
  (await f.pool.query<{ id: string }>('insert into tracks (event_id, name) values ($1, $2) returning id', [eventId, name])).rows[0]?.id ?? '';

describe('hacker teams (SPEC F15, v0.7)', () => {
  it('T-TEAM-02: create, join with a typed code, pick a released track and leave; only your own accepted row, only while open', async () => {
    const [a, b, n] = [await as(f.p.A), await as(f.p.B), await as(f.p.N)];
    expect(await createTeam(db(), a, f.p.A, 'Data Wizards')).toBe('CLOSED');
    await setOpen(f.e1.id, true);
    expect(await createTeam(db(), a, f.p.A, '   ')).toBe('INVALID_NAME');
    expect(await createTeam(db(), a, f.p.B, 'Data Wizards')).toBe('NOT_FOUND'); // B's row, A's email
    expect(await createTeam(db(), a, f.p.A, 'Data Wizards')).toBe('CREATED');
    const team = await teamRow('Data Wizards');
    expect(team?.join_code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    const code = team?.join_code ?? '';
    expect(await teamOf(f.p.A)).toBe(team?.id);
    expect(await createTeam(db(), a, f.p.A, 'Another')).toBe('IN_A_TEAM');
    expect(await createTeam(db(), b, f.p.B, 'data WIZARDS')).toBe('NAME_TAKEN');

    // A code typed in lowercase with a dash; codes that don't exist, or belong to another event.
    expect(await joinTeam(db(), b, f.p.B, { code: `${code.slice(0, 4).toLowerCase()}-${code.slice(4)}` })).toBe('JOINED');
    expect(await joinTeam(db(), b, f.p.B, { code })).toBe('IN_A_TEAM');
    expect(await joinTeam(db(), n, f.p.N, { code: 'ZZZZZZZZ' })).toBe('BAD_CODE');
    expect(await joinTeam(db(), n, f.p.N, { code: 'nope' })).toBe('BAD_CODE');
    await setOpen(f.e2.id, true);
    expect(await createTeam(db(), await as(f.p.X), f.p.X, 'Elsewhere')).toBe('CREATED');
    expect(await joinTeam(db(), n, f.p.N, { code: (await teamRow('Elsewhere'))?.join_code ?? '' })).toBe('BAD_CODE');
    // Waitlisted and withdrawn people can't team up.
    expect(await joinTeam(db(), await as(f.p.C), f.p.C, { code })).toBe('NOT_FOUND');
    expect(await createTeam(db(), await as(f.p.Wd), f.p.Wd, 'Withdrawn')).toBe('NOT_FOUND');

    // Tracks: only once released, only this event's, only for a member; still possible after forming closes.
    const ai = await track(f.e1.id, 'Best AI/ML Project');
    const other = await track(f.e2.id, 'Elsewhere Track');
    expect(await setTeamTrack(db(), a, f.p.A, ai)).toBe('NOT_RELEASED');
    await f.pool.query('update events set tracks_released = true where id = $1', [f.e1.id]);
    expect(await setTeamTrack(db(), a, f.p.A, other)).toBe('NOT_FOUND');
    expect(await setTeamTrack(db(), n, f.p.N, ai)).toBe('NOT_FOUND'); // N has no team
    await setOpen(f.e1.id, false);
    expect(await setTeamTrack(db(), b, f.p.B, ai)).toBe('SAVED');
    expect((await teamRow('Data Wizards'))?.track_id).toBe(ai);
    expect(await leaveTeam(db(), b, f.p.B)).toBe('CLOSED');
    await setOpen(f.e1.id, true);

    // The last one to leave deletes the team.
    expect(await leaveTeam(db(), b, f.p.B)).toBe('LEFT');
    expect(await teamOf(f.p.B)).toBeNull();
    expect(await teamRow('Data Wizards')).toBeDefined();
    expect(await leaveTeam(db(), a, f.p.A)).toBe('LEFT');
    expect(await teamRow('Data Wizards')).toBeUndefined();
    expect(await leaveTeam(db(), a, f.p.A)).toBe('NOT_FOUND');

    // After the event ends, nothing changes.
    await f.pool.query(`update events set ends_at = now() - interval '1 minute', starts_at = now() - interval '1 day' where id = $1`, [f.e1.id]);
    expect(await createTeam(db(), a, f.p.A, 'Too Late')).toBe('NOT_FOUND');
    await f.pool.query(`update events set starts_at = now(), ends_at = now() + interval '1 day' where id = $1`, [f.e1.id]);

    // I-11: the audit trail has ids only: no team names, codes or emails.
    const { rows } = await f.pool.query<{ action: string; detail: unknown }>(`select action, detail from audit_log where event_id = $1 and action like 'team.%'`, [f.e1.id]);
    expect(new Set(rows.map((r) => r.action))).toEqual(new Set(['team.create', 'team.join', 'team.track', 'team.leave']));
    expect(JSON.stringify(rows)).not.toMatch(new RegExp(`wizards|${code}|@`, 'i'));
  });

  it('T-TEAM-03: parallel joins never overfill a team; a join racing the last leaver never lands in a deleted team', async () => {
    await setOpen(f.e1.id, true);
    const owner = await f.addParticipant(f.e1.id, { withPass: false });
    expect(await createTeam(db(), await as(owner.id), owner.id, 'Full House')).toBe('CREATED');
    const team = await teamRow('Full House');
    const joiners = await Promise.all(Array.from({ length: 10 }, () => f.addParticipant(f.e1.id, { withPass: false })));
    const join = async (id: string, code: string) =>
      (await f.pool.query<{ r: string }>('select team_join($1, $2, $3, $4) as r', [id, await emailOf(id), f.staff.vol1, code])).rows[0]?.r;
    const results = await Promise.all(joiners.map((j) => join(j.id, team?.join_code ?? '')));
    expect(results.filter((r) => r === 'JOINED')).toHaveLength(3);
    expect(results.filter((r) => r === 'TEAM_FULL')).toHaveLength(7);
    expect((await f.pool.query('select 1 from participants where team_id = $1', [team?.id])).rowCount).toBe(4);

    // The database refuses a 5th member however it's added (organizers write the column directly).
    const fifth = joiners.find((_, i) => results[i] === 'TEAM_FULL')?.id;
    await expect(f.pool.query('update participants set team_id = $1 where id = $2', [team?.id, fifth])).rejects.toMatchObject({ code: '23514' });

    for (let round = 0; round < 30; round++) {
      const [leaver, joiner] = await Promise.all([f.addParticipant(f.e1.id, { withPass: false }), f.addParticipant(f.e1.id, { withPass: false })]);
      expect(await createTeam(db(), await as(leaver.id), leaver.id, `Race ${round}`)).toBe('CREATED');
      const code = (await teamRow(`Race ${round}`))?.join_code ?? '';
      const leave = async () => (await f.pool.query<{ r: string }>('select team_leave($1, $2, $3) as r', [leaver.id, await emailOf(leaver.id), f.staff.vol1])).rows[0]?.r;
      const [left, joined] = await Promise.all([leave(), join(joiner.id, code)]);
      expect(left).toBe('LEFT');
      const now = await teamOf(joiner.id);
      if (joined === 'JOINED') expect(now, `round ${round}`).not.toBeNull();
      else expect([joined, now], `round ${round}`).toEqual(['BAD_CODE', null]);
    }
  });
  it('T-RSVP-03 (v0.11.25): a member who says No, has their RSVP revoked or misses the deadline leaves their team; an emptied team is deleted', async () => {
    await setOpen(f.e1.id, true);
    const members = await Promise.all(Array.from({ length: 4 }, () => f.addParticipant(f.e1.id, { withPass: false })));
    expect(await createTeam(db(), await as(members[0]!.id), members[0]!.id, 'Leavers')).toBe('CREATED');
    const team = await teamRow('Leavers');
    for (const m of members.slice(1)) expect(await joinTeam(db(), await as(m.id), m.id, { code: team?.join_code ?? '' })).toBe('JOINED');
    // No: through the RSVP answer itself.
    const token = 'n'.repeat(32);
    await f.pool.query(`update participants set rsvp_token_hash = encode(sha256($2::bytea), 'hex') where id = $1`, [members[1]!.id, token]);
    expect((await f.pool.query('select rsvp_respond(encode(sha256($1::bytea), \'hex\'), false) as r', [token])).rows[0]?.r).toBe('NOT_GOING');
    expect(await teamOf(members[1]!.id)).toBeNull();
    // Revoked RSVP (back to pending).
    await f.pool.query('select revoke_rsvp($1, $2, $3)', [f.e1.id, members[2]!.id, f.staff.org1]);
    expect(await teamOf(members[2]!.id)).toBeNull();
    // A 4-member team that lost two has room again.
    const newcomer = await f.addParticipant(f.e1.id, { withPass: false });
    expect(await joinTeam(db(), await as(newcomer.id), newcomer.id, { code: team?.join_code ?? '' })).toBe('JOINED');
    // The deadline job withdraws by status; the rest leave too, and the emptied team goes.
    await f.pool.query(`update participants set status = 'withdrawn' where id = any($1)`, [[members[0]!.id, members[3]!.id, newcomer.id]]);
    expect(await teamRow('Leavers')).toBeUndefined();
    // An organizer's team made empty on purpose isn't touched by this rule.
    await f.pool.query(`insert into teams (event_id, name, join_code) values ($1, 'Prepared empty', 'PRPRMPTY')`, [f.e1.id]);
    await f.pool.query(`update participants set status = 'withdrawn' where id = $1`, [f.p.Wd]);
    expect(await teamRow('Prepared empty')).toBeDefined();
  });
});

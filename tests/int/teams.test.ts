import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateJoinCode } from '@/lib/domain/team';
import { generateToken } from '@/lib/domain/token';
import { hackerDirectory } from '@/lib/me/hackers';
import { myEvent } from '@/lib/me/profile';
import { createTeam, inviteTeammate, joinTeam, leaveTeam, myTeam, removeTeammate, saveLooking, setLooking, setTeamTracks, setTrackInterests } from '@/lib/me/team';
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
    expect(await setTeamTracks(db(), a, f.p.A, [ai])).toBe('NOT_RELEASED');
    await f.pool.query('update events set tracks_released = true where id = $1', [f.e1.id]);
    expect(await setTeamTracks(db(), a, f.p.A, [other])).toBe('BAD_TRACK'); // v0.11.50: was NOT_FOUND
    expect(await setTeamTracks(db(), n, f.p.N, [ai])).toBe('NOT_FOUND'); // N has no team
    await setOpen(f.e1.id, false);
    expect(await setTeamTracks(db(), b, f.p.B, [ai])).toBe('SAVED');
    expect((await f.pool.query('select track_id from team_tracks where team_id = $1', [(await teamRow('Data Wizards'))?.id])).rows).toEqual([{ track_id: ai }]);
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
    const token = generateToken();
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

  it('T-TEAM-10 (v0.11.44): any member removes another while forming is open; the team gets a new code; races never deadlock', async () => {
    await setOpen(f.e1.id, true);
    const [a, b, c, d, e] = await Promise.all(Array.from({ length: 5 }, () => f.addParticipant(f.e1.id, { withPass: false })));
    const [asA, asB] = [await as(a!.id), await as(b!.id)];
    expect(await createTeam(db(), asA, a!.id, 'Kickers')).toBe('CREATED');
    const before = await teamRow('Kickers');
    for (const m of [b!, c!]) expect(await joinTeam(db(), await as(m.id), m.id, { code: before?.join_code ?? '' })).toBe('JOINED');
    expect(await createTeam(db(), await as(d!.id), d!.id, 'Elsewhere Kickers')).toBe('CREATED');
    await f.pool.query(`update participants set team_status = 'looking' where id = $1`, [b!.id]);

    // Only another member of your own team, only your own row, only while forming is open.
    expect(await removeTeammate(db(), asA, a!.id, a!.id)).toBe('NOT_FOUND'); // yourself: that's Leave team
    expect(await removeTeammate(db(), asA, a!.id, d!.id)).toBe('NOT_FOUND'); // another team
    expect(await removeTeammate(db(), asA, a!.id, f.p.X)).toBe('NOT_FOUND'); // another event
    expect(await removeTeammate(db(), asA, a!.id, 'nope')).toBe('NOT_FOUND');
    expect(await removeTeammate(db(), asB, a!.id, c!.id)).toBe('NOT_FOUND'); // A's row, B's email
    await setOpen(f.e1.id, false);
    expect(await removeTeammate(db(), asA, a!.id, b!.id)).toBe('CLOSED');
    await setOpen(f.e1.id, true);
    expect(await teamOf(b!.id)).toBe(before?.id);

    expect(await removeTeammate(db(), asA, a!.id, b!.id)).toBe('REMOVED');
    expect(await teamOf(b!.id)).toBeNull();
    expect(await removeTeammate(db(), asA, a!.id, b!.id)).toBe('NOT_FOUND');
    const after = await teamRow('Kickers');
    expect(after?.join_code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(after?.join_code).not.toBe(before?.join_code);
    // The old code no longer works; the new one does. Their answer was looking, so they're back under Looking.
    expect(await joinTeam(db(), asB, b!.id, { code: before?.join_code ?? '' })).toBe('BAD_CODE');
    expect((await f.pool.query('select looking_for_team from participants where id = $1', [b!.id])).rows[0]?.looking_for_team).toBe(true);
    expect(await joinTeam(db(), await as(e!.id), e!.id, { code: after?.join_code ?? '' })).toBe('JOINED');

    // I-11: ids only.
    const { rows } = await f.pool.query<{ detail: unknown }>(`select detail from audit_log where action = 'team.remove' and subject_id = $1`, [b!.id]);
    expect(rows).toEqual([{ detail: { teamId: before?.id } }]);

    // Two members removing each other, and a removal racing the member's own leave: one wins, never a deadlock.
    const people = async (n: number) => {
      const list = await Promise.all(Array.from({ length: n }, () => f.addParticipant(f.e1.id, { withPass: false })));
      return Promise.all(list.map(async (p) => ({ id: p.id, email: await emailOf(p.id) })));
    };
    const call = async (fn: string, by: { id: string; email: string }, ...rest: string[]) =>
      (await f.pool.query<{ r: string }>(`select ${fn}($1, $2, $3${rest.map((_, i) => `, $${i + 4}`).join('')}) as r`, [by.id, by.email, f.staff.vol1, ...rest])).rows[0]?.r;
    for (let round = 0; round < 30; round++) {
      const [x, y, z, w] = await people(4);
      expect(await createTeam(db(), { id: f.staff.vol1, email: x!.email }, x!.id, `Duel ${round}`)).toBe('CREATED');
      expect(await createTeam(db(), { id: f.staff.vol1, email: z!.email }, z!.id, `Quit ${round}`)).toBe('CREATED');
      expect(await joinTeam(db(), { id: f.staff.vol1, email: y!.email }, y!.id, { code: (await teamRow(`Duel ${round}`))?.join_code ?? '' })).toBe('JOINED');
      expect(await joinTeam(db(), { id: f.staff.vol1, email: w!.email }, w!.id, { code: (await teamRow(`Quit ${round}`))?.join_code ?? '' })).toBe('JOINED');
      const [duel, quit] = await Promise.all([
        Promise.all([call('team_remove', x!, y!.id, generateJoinCode()), call('team_remove', y!, x!.id, generateJoinCode())]),
        Promise.all([call('team_remove', z!, w!.id, generateJoinCode()), call('team_leave', w!)]),
      ]);
      expect(duel.toSorted(), `round ${round}`).toEqual(['NOT_FOUND', 'REMOVED']);
      expect([await teamOf(x!.id), await teamOf(y!.id)].filter(Boolean), `round ${round}`).toHaveLength(1);
      expect([['REMOVED', 'NOT_FOUND'], ['NOT_FOUND', 'LEFT']], `round ${round}`).toContainEqual(quit);
      expect([await teamOf(z!.id) !== null, await teamOf(w!.id)], `round ${round}`).toEqual([true, null]);
    }
  });

  // v0.11.47: edge cases two reviews of the Team section found.
  const people = (n: number) => Promise.all(Array.from({ length: n }, () => f.addParticipant(f.e1.id, { withPass: false }).then((p) => p.id)));
  const field = async (id: string, column: string) => (await f.pool.query(`select ${column} as v from participants where id = $1`, [id])).rows[0]?.v;
  const sentBy = async (id: string) => Number((await f.pool.query('select count(*) from team_invites where invited_by = $1', [id])).rows[0]?.count);

  it('T-TEAM-11 (v0.11.47): a member who leaves a team, however they leave, takes their sent invites and their "I have a team" answer with them', async () => {
    await setOpen(f.e1.id, true);
    const [a, b, c, d, e, g, x, y, z, v] = await people(10);
    expect(await createTeam(db(), await as(a!), a!, 'Edge Case')).toBe('CREATED');
    const code = (await teamRow('Edge Case'))?.join_code ?? '';
    for (const m of [b!, c!]) expect(await joinTeam(db(), await as(m), m, { code })).toBe('JOINED');
    await f.pool.query(`update participants set looking_for_team = true where id = any($1)`, [[x, y, z, v]]);
    await f.pool.query(`update participants set team_status = 'team' where id = any($1)`, [[b, c]]);
    for (const [by, to] of [[a, x], [b, y], [c, z]] as const) expect(await inviteTeammate(db(), await as(by!), by!, to!)).toBe('INVITED');

    // Removed, left, withdrawn: their invites go; the team's other invites stay.
    expect(await removeTeammate(db(), await as(a!), a!, b!)).toBe('REMOVED');
    expect(await leaveTeam(db(), await as(c!), c!)).toBe('LEFT');
    expect(await joinTeam(db(), await as(d!), d!, { code: (await teamRow('Edge Case'))?.join_code ?? '' })).toBe('JOINED');
    expect(await inviteTeammate(db(), await as(d!), d!, v!)).toBe('INVITED');
    await f.pool.query(`update participants set status = 'withdrawn' where id = $1`, [d]);
    expect([await sentBy(b!), await sentBy(c!), await sentBy(d!), await sentBy(a!)]).toEqual([0, 0, 0, 1]);
    // An organizer moving someone to another team: the same.
    expect(await createTeam(db(), await as(e!), e!, 'Edge Other')).toBe('CREATED');
    expect(await joinTeam(db(), await as(g!), g!, { code: (await teamRow('Edge Other'))?.join_code ?? '' })).toBe('JOINED');
    expect(await inviteTeammate(db(), await as(g!), g!, y!)).toBe('INVITED');
    await f.pool.query('update participants set team_id = $1 where id = $2', [(await teamRow('Edge Case'))?.id, g]);
    expect(await sentBy(g!)).toBe(0);

    // "I have a team" no longer holds once they're out: solo, still a finished answer, listed nowhere.
    expect([await field(b!, 'team_status'), await field(c!, 'team_status')]).toEqual(['solo', 'solo']);
    expect([await field(b!, 'looking_for_team'), await field(c!, 'looking_for_team')]).toEqual([false, false]);
  });

  it('T-TEAM-11 (v0.11.47): a tombstone that empties a team deletes it; a page read after a removal shows no team', async () => {
    await setOpen(f.e1.id, true);
    const [lone, a, b] = await people(3);
    expect(await createTeam(db(), await as(lone!), lone!, 'Lone Edge')).toBe('CREATED');
    await f.pool.query('select delete_participant($1, $2, $3)', [f.e1.id, lone, f.staff.org1]);
    expect(await teamRow('Lone Edge')).toBeUndefined();

    expect(await createTeam(db(), await as(a!), a!, 'Stale Read')).toBe('CREATED');
    const team = await teamRow('Stale Read');
    expect(await joinTeam(db(), await as(b!), b!, { code: team?.join_code ?? '' })).toBe('JOINED');
    const before = await myEvent(db(), (await as(b!)).email, new Date());
    expect(before?.teamId).toBe(team?.id);
    expect(await removeTeammate(db(), await as(a!), a!, b!)).toBe('REMOVED');
    // B's page had already read its team id when A removed B: it must not show the team (or its new code).
    expect((await myTeam(db(), before!)).team).toBeNull();
  });

  it('T-TEAM-11 (v0.11.47): a refused Looking save changes nothing; racing On/Off taps never end Looking with "solo"', async () => {
    await setOpen(f.e1.id, true);
    const [g, h] = await people(2);
    const gone = await track(f.e1.id, 'Edge deleted track');
    await f.pool.query('delete from tracks where id = $1', [gone]);
    expect(await saveLooking(db(), await as(g!), g!, true, [gone])).toBe('BAD_TRACK');
    expect(await field(g!, 'looking_for_team')).toBe(false);
    await f.pool.query(`update events set ends_at = now() - interval '1 minute', starts_at = now() - interval '1 day' where id = $1`, [f.e1.id]);
    expect(await saveLooking(db(), await as(g!), g!, true, [])).toBe('NOT_FOUND');
    await f.pool.query(`update events set starts_at = now(), ends_at = now() + interval '1 day' where id = $1`, [f.e1.id]);
    expect(await field(g!, 'looking_for_team')).toBe(false);

    const asH = await as(h!);
    for (let round = 0; round < 30; round++) {
      await f.pool.query(`update participants set looking_for_team = true, team_status = 'looking' where id = $1`, [h]);
      await Promise.all([setLooking(db(), asH, h!, false), setLooking(db(), asH, h!, true)]);
      const state = [await field(h!, 'looking_for_team'), await field(h!, 'team_status')];
      expect([[true, 'looking'], [false, 'solo']], `round ${round}`).toContainEqual(state);
    }
  });

  it('T-TEAM-11 (v0.11.47): at most 20 invites an hour per team; the Track filter skips hackers in a team; deleting a track mid-save never errors', async () => {
    await setOpen(f.e1.id, true);
    const [inviter, ...targets] = await people(22);
    await f.pool.query(`update participants set looking_for_team = true where id = any($1)`, [targets]);
    expect(await createTeam(db(), await as(inviter!), inviter!, 'Busy Inviters')).toBe('CREATED');
    const results = [];
    for (const t of targets.slice(0, 21)) results.push(await inviteTeammate(db(), await as(inviter!), inviter!, t));
    expect(results.slice(0, 20).every((r) => r === 'INVITED')).toBe(true);
    expect(results[20]).toBe('RATE_LIMITED');

    // Wants to do is hidden on a teamed hacker's card, so the Track filter doesn't match them either.
    const ai = await track(f.e1.id, 'Edge filter track');
    const [free, teamed, viewer] = [targets[20]!, inviter!, targets[0]!];
    await f.pool.query(`insert into participant_tracks (participant_id, track_id, event_id) select unnest($1::uuid[]), $2, $3`, [[free, teamed], ai, f.e1.id]);
    await f.pool.query('update participants set directory_opt_in = true where id = any($1)', [[free, teamed]]);
    const me = await myEvent(db(), (await as(viewer)).email, new Date());
    const found = (await hackerDirectory(db(), me!, (await as(viewer)).email, { looking: false, search: '', pace: '', track: ai })).people.map((p) => p.id);
    expect(found).toEqual([free]);

    // An organizer deleting a track while a hacker saves their picks: one waits for the other.
    const asV = await as(viewer);
    for (let round = 0; round < 30; round++) {
      const [picked, kept] = [await track(f.e1.id, `Race pick ${round}`), await track(f.e1.id, `Race keep ${round}`)];
      expect(await setTrackInterests(db(), asV, viewer, [picked])).toBe('SAVED');
      const [save, del] = await Promise.allSettled([setTrackInterests(db(), asV, viewer, [picked, kept]), f.pool.query('delete from tracks where id = $1', [picked])]);
      expect(del.status, `round ${round}`).toBe('fulfilled');
      expect(save.status === 'fulfilled' ? save.value : save.reason, `round ${round}`).toMatch(/^(SAVED|BAD_TRACK)$/);
    }
  });

  it('T-TEAM-12 (v0.11.50): a team picks any number of tracks; none clears them; only tracks of this event; racing saves and track deletes never mix or error', async () => {
    await f.pool.query('update events set tracks_released = true where id = $1', [f.e1.id]);
    const [p, q] = await Promise.all([f.addParticipant(f.e1.id, { withPass: false }), f.addParticipant(f.e1.id, { withPass: false })]);
    const { rows: [team] } = await f.pool.query<{ id: string }>(`insert into teams (event_id, name, join_code) values ($1, 'Many Tracks', $2) returning id`, [f.e1.id, generateJoinCode()]);
    await f.pool.query('update participants set team_id = $1 where id = any($2)', [team!.id, [p.id, q.id]]);
    const [asP, asQ] = [await as(p.id), await as(q.id)];
    const [ai, hw, web] = [await track(f.e1.id, 'Multi AI'), await track(f.e1.id, 'Multi Hardware'), await track(f.e1.id, 'Multi Web')];
    const elsewhere = await track(f.e2.id, 'Multi elsewhere');
    const sorted = (ids: string[]) => [...ids].sort();
    const picked = async () => sorted((await f.pool.query<{ track_id: string }>('select track_id from team_tracks where team_id = $1', [team!.id])).rows.map((r) => r.track_id));

    expect(await setTeamTracks(db(), asP, p.id, [ai, hw, ai])).toBe('SAVED');
    expect(await picked()).toEqual(sorted([ai, hw]));
    // Any member replaces the whole set, and the Team page reads it back.
    expect(await setTeamTracks(db(), asQ, q.id, [hw, web])).toBe('SAVED');
    expect(await picked()).toEqual(sorted([hw, web]));
    const me = await myEvent(db(), asP.email, new Date());
    expect(sorted((await myTeam(db(), me!)).team!.trackIds)).toEqual(sorted([hw, web]));
    // Another event's track, or not a track id: nothing changes.
    expect(await setTeamTracks(db(), asP, p.id, [ai, elsewhere])).toBe('BAD_TRACK');
    expect(await setTeamTracks(db(), asP, p.id, ['not-a-uuid'])).toBe('BAD_TRACK');
    expect(await picked()).toEqual(sorted([hw, web]));
    // None clears them.
    expect(await setTeamTracks(db(), asP, p.id, [])).toBe('SAVED');
    expect(await picked()).toEqual([]);
    // The app before v0.11.50 (until it is redeployed) still saves one track: a list of one.
    const old = (track: string) => f.pool.query<{ r: string }>('select team_set_track($1, $2, $3, $4) as r', [p.id, asP.email, f.staff.vol1, track]);
    expect((await old(ai)).rows[0]?.r).toBe('SAVED');
    expect(await picked()).toEqual([ai]);
    expect((await old(elsewhere)).rows[0]?.r).toBe('NOT_FOUND');
    expect(await picked()).toEqual([ai]);

    // Two members saving at once: one set wins whole, never a mix of both.
    const save = (who: { id: string }, email: string, ids: string[]) =>
      f.pool.query<{ r: string }>('select team_set_tracks($1, $2, $3, $4) as r', [who.id, email, f.staff.vol1, ids]);
    for (let round = 0; round < 30; round++) {
      const [x, y] = await Promise.all([save(p, asP.email, [ai, hw]), save(q, asQ.email, [web])]);
      expect([x.rows[0]?.r, y.rows[0]?.r], `round ${round}`).toEqual(['SAVED', 'SAVED']);
      expect([sorted([ai, hw]), [web]], `round ${round}`).toContainEqual(await picked());
    }
    // An organizer deleting a picked track while a member saves: one waits for the other, never an error.
    for (let round = 0; round < 30; round++) {
      const gone = await track(f.e1.id, `Multi race ${round}`);
      expect((await save(p, asP.email, [gone, ai])).rows[0]?.r).toBe('SAVED');
      const [saved, del] = await Promise.all([save(q, asQ.email, [gone, hw]), f.pool.query('delete from tracks where id = $1', [gone])]);
      expect(del.rowCount, `round ${round}`).toBe(1);
      expect(saved.rows[0]?.r, `round ${round}`).toMatch(/^(SAVED|BAD_TRACK)$/);
      expect(await picked(), `round ${round}`).toEqual(saved.rows[0]?.r === 'SAVED' ? [hw] : [ai]);
    }
  });
});

import { afterAll, beforeAll, expect, it } from 'vitest';
import { generateToken, sha256hex } from '@/lib/domain/token';
import { drainUntilIdle } from '@/lib/email/drain';
import { hackerDirectory } from '@/lib/me/hackers';
import { myEvent } from '@/lib/me/profile';
import { createTeam, declineInvite, inviteTeammate, joinTeam, myTeam, setLooking } from '@/lib/me/team';
import { createRsvpHandler } from '@/lib/rsvp/handlers';
import { mockProvider, onlyEmailTo, sentTo, serviceClient } from '../fixtures/mail';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
const db = serviceClient();
beforeAll(async () => {
  f = await createStandardFixture();
  // These cases cover the names-only Looking listing, so start everyone out of the full directory (on by default since v0.11.19).
  await f.pool.query('update participants set directory_opt_in = false where event_id = any($1)', [[f.e1.id, f.e2.id]]);
});
afterAll(async () => { await f.close(); });
const as = async (id: string) => ({ id: f.staff.vol1, email: (await f.pool.query<{ email: string }>('select email from participants where id = $1', [id])).rows[0]?.email ?? '' });
const teamOf = async (id: string) => (await f.pool.query<{ team_id: string }>('select team_id from participants where id = $1', [id])).rows[0]?.team_id ?? '';
const invites = async (id: string) => (await f.pool.query('select team_id from team_invites where participant_id = $1', [id])).rows;
const pageFor = async (id: string) => {
  const me = await myEvent(db, (await as(id)).email, new Date());
  if (!me) throw new Error('fixture attendee missing');
  return { ...await myTeam(db, me), directory: await hackerDirectory(db, me, (await as(id)).email, { looking: true, search: '', pace: '' }) };
};
const mail = mockProvider();
const drain = () => drainUntilIdle({ db, provider: mail.provider, appOrigin: 'https://station.example.test', from: 'club@example.test', passSecret: 's'.repeat(32) });

it('T-TEAM-05: opt-in directory, invite and email, consent and cleanup; own rows and same event only', async () => {
  await f.pool.query('update events set teams_open = true where id = $1', [f.e1.id]);
  const a = await as(f.p.A), b = await as(f.p.B), n = await as(f.p.N);
  expect(await createTeam(db, a, f.p.A, 'Data Wizards')).toBe('CREATED');
  const teamId = await teamOf(f.p.A);
  expect(await inviteTeammate(db, a, f.p.A, f.p.N)).toBe('NOT_LOOKING');
  expect(await setLooking(db, a, f.p.N, true)).toBe('NOT_FOUND');
  expect(await setLooking(db, n, f.p.N, true)).toBe('SAVED');
  await f.pool.query('update participants set looking_for_team = true where id = any($1)', [[f.p.C, f.p.Wd, f.p.X]]);
  await f.pool.query('update participants set looking_for_team = true, deleted_at = now() where id = $1', [f.p.Rv]);
  expect((await pageFor(f.p.A)).directory).toEqual([{ id: f.p.N, name: 'Nia Fixture' }]);
  expect((await pageFor(f.p.B)).directory).toEqual([{ id: f.p.N, name: 'Nia Fixture' }]);
  await f.pool.query('update participants set looking_for_team = false, deleted_at = null where id = any($1)', [[f.p.C, f.p.Wd, f.p.X, f.p.Rv]]);
  expect((await pageFor(f.p.N)).directory).toEqual([]); // never yourself
  expect(await inviteTeammate(db, b, f.p.A, f.p.N)).toBe('NOT_FOUND');
  expect(await inviteTeammate(db, a, f.p.A, f.p.N)).toBe('INVITED');
  expect(await inviteTeammate(db, a, f.p.A, f.p.N)).toBe('ALREADY_INVITED');
  expect((await f.pool.query('select kind from email_outbox where participant_id = $1', [f.p.N])).rows).toEqual([{ kind: 'team_invite' }]);
  expect((await pageFor(f.p.N)).invites).toEqual([{ teamId, teamName: 'Data Wizards', from: 'Ada' }]);
  await f.pool.query('delete from passes where participant_id = $1', [f.p.N]);
  await drain();
  const email = onlyEmailTo(mail.sent, n.email);
  const joinCode = (await f.pool.query<{ join_code: string }>('select join_code from teams where id = $1', [teamId])).rows[0]?.join_code ?? '';
  expect(email.subject).toBe(`Ada invited you to join Data Wizards at ${f.e1.name}`);
  expect(email.text).toContain('https://station.example.test/me/team');
  expect(email.html).toContain('Data Wizards');
  expect(email.html).toContain('Ada');
  expect(email.html + email.text).not.toContain(joinCode);
  expect(email.text).not.toContain('/p#');
  expect((await f.pool.query('select id from passes where participant_id = $1', [f.p.N])).rows).toEqual([]);
  expect(await joinTeam(db, b, f.p.B, { teamId })).toBe('BAD_CODE');
  expect(await createTeam(db, b, f.p.B, 'Other Team')).toBe('CREATED');
  expect(await inviteTeammate(db, b, f.p.B, f.p.N)).toBe('INVITED');
  await f.pool.query('update events set teams_open = false where id = $1', [f.e1.id]);
  expect(await joinTeam(db, n, f.p.N, { teamId })).toBe('CLOSED');
  await f.pool.query('update events set teams_open = true where id = $1', [f.e1.id]);
  expect(await joinTeam(db, n, f.p.N, { teamId })).toBe('JOINED');
  expect(await invites(f.p.N)).toEqual([]);
  expect((await f.pool.query('select looking_for_team from participants where id = $1', [f.p.N])).rows).toEqual([{ looking_for_team: false }]);
  expect(await setLooking(db, n, f.p.N, true)).toBe('NOT_FOUND');
  const sent = sentTo(mail.sent, n.email).length;
  await drain();
  expect(sentTo(mail.sent, n.email)).toHaveLength(sent);
  expect((await f.pool.query('select status from email_outbox where participant_id = $1 order by created_at', [f.p.N])).rows).toEqual([{ status: 'sent' }, { status: 'cancelled' }]);
  await f.pool.query('update participants set looking_for_team = true where id = $1', [f.p.X]);
  expect(await inviteTeammate(db, a, f.p.A, f.p.X)).toBe('NOT_LOOKING');
  await f.pool.query('update events set teams_open = false where id = $1', [f.e1.id]);
  expect(await inviteTeammate(db, a, f.p.A, f.p.X)).toBe('CLOSED');
  expect((await pageFor(f.p.A)).directory).toEqual([]);
  const audit = (await f.pool.query<{ detail: unknown }>("select detail from audit_log where event_id = $1 and action = 'team.invite'", [f.e1.id])).rows;
  expect(audit).toHaveLength(2);
  expect(audit.map((r) => r.detail)).toEqual([{}, {}]);
});

it('T-TEAM-05: decline is own-invite only; one in-flight email, newest invite, full team, code and organizer cleanup, tombstone', async () => {
  await f.pool.query('update events set teams_open = true where id = $1', [f.e1.id]);
  const a = await as(f.p.A), b = await as(f.p.B), t = await as(f.p.T), rv = await as(f.p.Rv);
  const teamId = await teamOf(f.p.A), other = await teamOf(f.p.B);
  expect(await setLooking(db, t, f.p.T, true)).toBe('SAVED');
  expect(await inviteTeammate(db, a, f.p.A, f.p.T)).toBe('INVITED');
  expect(await inviteTeammate(db, b, f.p.B, f.p.T)).toBe('INVITED');
  expect((await f.pool.query('select kind from email_outbox where participant_id = $1', [f.p.T])).rows).toEqual([{ kind: 'team_invite' }]);
  await drain();
  expect(onlyEmailTo(mail.sent, t.email).subject).toContain('Ben invited you to join Other Team');
  expect(await declineInvite(db, a, f.p.T, teamId)).toBe('NOT_FOUND');
  expect(await declineInvite(db, t, f.p.T, teamId)).toBe('DECLINED');
  expect(await invites(f.p.T)).toEqual([{ team_id: other }]);
  // Two members already; fill the remaining places through the organizer route.
  await f.pool.query('update participants set team_id = $1 where id = any($2)', [teamId, [f.p.Rv, f.p.Wd]]);
  expect(await inviteTeammate(db, a, f.p.A, f.p.T)).toBe('TEAM_FULL');
  expect((await pageFor(f.p.A)).directory).toContainEqual({ id: f.p.T, name: 'Tess Fixture' }); // directory stays readable; inviting a fifth member is refused above
  await f.pool.query('insert into team_invites (team_id, participant_id, event_id) values ($1, $2, $3)', [teamId, f.p.T, f.e1.id]);
  expect(await joinTeam(db, t, f.p.T, { teamId })).toBe('TEAM_FULL');
  expect(await invites(f.p.T)).toHaveLength(2);
  await f.pool.query('update participants set team_id = null where id = $1', [f.p.Rv]);
  expect(await setLooking(db, rv, f.p.Rv, true)).toBe('SAVED');
  expect(await inviteTeammate(db, b, f.p.B, f.p.Rv)).toBe('INVITED');
  const code = (await f.pool.query<{ join_code: string }>('select join_code from teams where id = $1', [other])).rows[0]?.join_code ?? '';
  expect(await joinTeam(db, rv, f.p.Rv, { code })).toBe('JOINED');
  expect(await invites(f.p.Rv)).toEqual([]);
  await f.pool.query('update participants set team_id = $1 where id = $2', [other, f.p.T]);
  expect(await invites(f.p.T)).toEqual([]);
  await f.pool.query('update participants set team_id = null, looking_for_team = true where id = $1', [f.p.T]);
  expect(await inviteTeammate(db, a, f.p.A, f.p.T)).toBe('INVITED');
  await f.pool.query('select delete_participant($1, $2, $3)', [f.e1.id, f.p.T, f.staff.org1]);
  expect(await invites(f.p.T)).toEqual([]);
  await drain();
  expect(sentTo(mail.sent, rv.email)).toHaveLength(0);
  expect(sentTo(mail.sent, t.email)).toHaveLength(1);
});

it('T-TEAM-05: RSVP Yes stores the optional directory flag in the answer transaction; strict boolean', async () => {
  const token = generateToken();
  await f.pool.query('update participants set rsvp_token_hash = $2 where id = $1', [f.p.C, sha256hex(token)]);
  const handler = createRsvpHandler({ db, signIn: async () => 'wrong', scheduleDrain: () => undefined, drain });
  const call = (lookingForTeam: unknown) => handler(new Request('http://localhost/api/rsvp', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.55.1.1' }, body: JSON.stringify({ token, going: true, emergencyName: 'Sam', emergencyPhone: '416 555 0100', password: 'team-event-password', lookingForTeam }) }));
  expect((await call('true')).status).toBe(400);
  const response = await call(true);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ code: 'GOING' });
  expect((await f.pool.query('select status, looking_for_team from participants where id = $1', [f.p.C])).rows).toEqual([{ status: 'accepted', looking_for_team: true }]);
});


it('T-TEAM-05: directory excludes your own row with or without a team; SQL refuses self-invites', async () => {
  await f.pool.query('update events set teams_open = true where id = $1', [f.e1.id]);
  const viewer = await f.addParticipant(f.e1.id, { status: 'accepted' });
  const other = await f.addParticipant(f.e1.id, { status: 'accepted' });
  const user = await as(viewer.id);
  // Names-only Looking rows: not in the full directory (which is on by default and lists the viewer as "you").
  await f.pool.query('update participants set looking_for_team = true, directory_opt_in = false where id = any($1)', [[viewer.id, other.id]]);
  const directory = (await pageFor(viewer.id)).directory;
  expect(directory.map((p) => p.id)).toContain(other.id);
  expect(directory.map((p) => p.id)).not.toContain(viewer.id);
  const selfInvite = () => db.rpc('team_invite', {
    p_participant_id: viewer.id, p_email: user.email, p_user_id: user.id, p_invitee_id: viewer.id,
  });
  expect.soft(await selfInvite()).toMatchObject({ data: 'SELF', error: null });
  expect(await createTeam(db, user, viewer.id, 'Self exclusion')).toBe('CREATED');
  expect((await pageFor(viewer.id)).directory.map((p) => p.id)).not.toContain(viewer.id);
  expect.soft(await selfInvite()).toMatchObject({ data: 'SELF', error: null });
  expect(await inviteTeammate(db, user, viewer.id, viewer.id)).toBe('SELF');
  expect(await invites(viewer.id)).toEqual([]);
  expect((await f.pool.query("select id from email_outbox where participant_id = $1 and kind = 'team_invite'", [viewer.id])).rows).toEqual([]);
  expect((await f.pool.query("select id from audit_log where subject_id = $1 and action = 'team.invite'", [await teamOf(viewer.id)])).rows).toEqual([]);
});

it('T-TEAM-05: a teamed hacker stays out of looking after RSVP Yes and same-team updates', async () => {
  const viewer = await f.addParticipant(f.e1.id, { status: 'accepted' });
  const user = await as(viewer.id);
  await f.pool.query('update events set teams_open = true where id = $1', [f.e1.id]);
  expect(await createTeam(db, user, viewer.id, 'RSVP team')).toBe('CREATED');
  const token = generateToken();
  await f.pool.query('update participants set rsvp_token_hash = $2 where id = $1', [viewer.id, sha256hex(token)]);
  expect(await db.rpc('rsvp_respond', { p_token_hash: sha256hex(token), p_going: true, p_looking_for_team: true })).toMatchObject({ data: 'GOING', error: null });
  expect.soft((await f.pool.query('select looking_for_team from participants where id = $1', [viewer.id])).rows).toEqual([{ looking_for_team: false }]);
  await f.pool.query('update participants set team_id = team_id, looking_for_team = true where id = $1', [viewer.id]);
  expect((await f.pool.query('select looking_for_team from participants where id = $1', [viewer.id])).rows).toEqual([{ looking_for_team: false }]);
});

it('T-TEAM-05: same-name rows under different emails remain distinct; self-invites authenticate first', async () => {
  await f.pool.query('update events set teams_open = true where id = $1', [f.e1.id]);
  const viewer = await f.addParticipant(f.e1.id, { status: 'accepted' });
  const other = await f.addParticipant(f.e1.id, { status: 'accepted' });
  const user = await as(viewer.id), otherUser = await as(other.id);
  expect(user.email).not.toBe(otherUser.email);
  await f.pool.query("update participants set first_name = 'Same', last_name = 'Name', looking_for_team = true, directory_opt_in = false where id = any($1)", [[viewer.id, other.id]]);
  const directory = (await pageFor(viewer.id)).directory;
  expect(directory).toContainEqual({ id: other.id, name: 'Same Name' });
  expect(directory.map((p) => p.id)).not.toContain(viewer.id);
  expect(await inviteTeammate(db, user, viewer.id, viewer.id)).toBe('SELF');
  expect(await inviteTeammate(db, otherUser, viewer.id, viewer.id)).toBe('NOT_FOUND');
  expect(await createTeam(db, user, viewer.id, 'Same name team')).toBe('CREATED');
  expect((await pageFor(viewer.id)).directory).toContainEqual({ id: other.id, name: 'Same Name' });
  expect(await inviteTeammate(db, user, viewer.id, other.id)).toBe('INVITED');
  expect(await invites(viewer.id)).toEqual([]);
});

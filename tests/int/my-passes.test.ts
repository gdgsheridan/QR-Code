import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { passToken, sha256hex } from '@/lib/domain/token';
import { myEvent, saveBadgeProfile } from '@/lib/me/profile';
import { setLooking } from '@/lib/me/team';
import { myPasses } from '@/lib/pass/mine';
import { serviceClient } from '../fixtures/mail';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
const secret = 'test-secret-for-my-passes-000000000000';
beforeAll(async () => {
  f = await createStandardFixture();
});
afterAll(async () => {
  await f.close();
});

const emailOf = async (id: string) =>
  (await f.pool.query<{ email: string }>('select email from participants where id = $1', [id])).rows[0]?.email ?? '';
const mine = (email: string) => myPasses(serviceClient(), email, secret, new Date());

describe('/me (SPEC §6.1, v0.4)', () => {
  it('T-ME-01: shows only your own accepted passes, with a token that matches the stored hash', async () => {
    const a = await emailOf(f.p.A);
    // A's fixture pass has a random token (as before v0.4): it can't be shown again.
    expect((await mine(a)).map((p) => p.pass)).toEqual(['in_email']);

    const passId = randomUUID();
    const token = passToken(secret, passId);
    await f.pool.query('select issue_pass($1, $2, $3)', [f.p.A, sha256hex(token), passId]);
    const [only, ...rest] = await mine(` ${a.toUpperCase()} `);
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ participantId: f.p.A, pass: { token } });
    expect(only?.event.name).toBeTruthy();

    // Accepted but not issued yet (an RSVP Yes waiting on the outbox): "on its way".
    await f.pool.query(`update passes set revoked_at = now(), revoke_reason = 'manual' where participant_id = $1`, [f.p.A]);
    expect((await mine(a)).map((p) => p.pass)).toEqual(['on_its_way']);

    // Waitlisted, withdrawn, deleted, another event's past: nothing.
    expect(await mine(await emailOf(f.p.C))).toEqual([]);
    expect(await mine(await emailOf(f.p.Wd))).toEqual([]);
    await f.pool.query(`update events set starts_at = now() - interval '2 days', ends_at = now() - interval '1 day' where id = $1`, [f.e2.id]);
    expect(await mine(await emailOf(f.p.X))).toEqual([]);
  });
});

describe('/me badge profile (SPEC §6.5, v0.5)', () => {
  const row = async (id: string) =>
    (
      await f.pool.query<{ linkedin_url: string | null; profile_public: boolean; own: boolean }>(
        'select linkedin_url, profile_public, linkedin_set_at is not null as own from participants where id = $1',
        [id],
      )
    ).rows[0];

  it('T-ME-03: an attendee sets their own LinkedIn and sharing; invalid input and other people’s rows change nothing', async () => {
    const { id } = await f.addParticipant(f.e1.id);
    const user = { id: f.staff.vol1, email: (await emailOf(id)).toUpperCase() };
    const save = (participantId: string, linkedin: string, profilePublic: boolean) =>
      saveBadgeProfile(serviceClient(), user, participantId, { linkedin, profilePublic });

    expect(await save(id, 'linkedin.com/in/ada-l', true)).toBe('SAVED');
    expect(await row(id)).toEqual({ linkedin_url: 'https://www.linkedin.com/in/ada-l', profile_public: true, own: true });
    expect(await save(id, 'linkedin.com/company/x', false)).toBe('INVALID_LINKEDIN');
    expect(await row(id)).toEqual({ linkedin_url: 'https://www.linkedin.com/in/ada-l', profile_public: true, own: true });
    expect(await save(id, '  ', false)).toBe('SAVED');
    expect(await row(id)).toEqual({ linkedin_url: null, profile_public: false, own: true });

    const before = await row(f.p.B);
    expect(await save(f.p.B, 'linkedin.com/in/hijack', true)).toBe('NOT_FOUND');
    expect(await save('not-a-uuid', 'linkedin.com/in/hijack', true)).toBe('NOT_FOUND');
    expect(await row(f.p.B)).toEqual(before);

    const { rows } = await f.pool.query<{ actor_kind: string; detail: unknown }>(
      `select actor_kind, detail from audit_log where action = 'profile.update' and subject_id = $1`,
      [id],
    );
    expect(rows.map((r) => r.actor_kind)).toEqual(['participant', 'participant']);
    expect(JSON.stringify(rows)).not.toMatch(/linkedin|ada|@/i); // ids and the on/off flag only (I-11)
  });
});

describe('hacker menu (SPEC F14, v0.6)', () => {
  const details = async (id: string) =>
    (
      await f.pool.query(
        `select dietary_notes, dietary_set_at is not null as own_dietary, emergency_name, emergency_phone, emergency_relation
           from participants where id = $1`,
        [id],
      )
    ).rows[0];
  const contact = { emergencyName: 'Sam Lee', emergencyPhone: '+1 416 555 0100', emergencyRelation: 'Parent' };

  it('T-ME-10: profile setup (v0.9) saves the answers, finishes the profile, and moves the directory opt-in only on a change', async () => {
    const { id } = await f.addParticipant(f.e1.id);
    const email = await emailOf(id);
    const user = { id: f.staff.vol1, email };
    const setup = { ...contact, overnight: 'yes', teamStatus: 'looking', allergies: 'Peanuts', allergySeverity: 'severe', accessibility: 'Step-free access' };
    const save = (input: Parameters<typeof saveBadgeProfile>[3]) => saveBadgeProfile(serviceClient(), user, id, input, { setup: true });
    const row = async () =>
      (await f.pool.query('select overnight, team_status, allergies, allergy_severity, accessibility, looking_for_team from participants where id = $1', [id])).rows[0];

    expect((await myEvent(serviceClient(), email, new Date()))?.profileDone).toBe(false);
    expect(await save({ ...contact, teamStatus: 'solo' })).toBe('INVALID_OVERNIGHT');
    expect(await save({ ...setup, allergySeverity: '' })).toBe('INVALID_ALLERGY');
    expect(await save({ ...setup, teamStatus: 'duo' })).toBe('INVALID_TEAM_STATUS');
    expect(await save({ ...setup, accessibility: 'x'.repeat(501) })).toBe('INVALID_ACCESSIBILITY');
    expect(await row()).toMatchObject({ overnight: null, team_status: null, looking_for_team: false });

    expect(await save(setup)).toBe('SAVED');
    expect(await row()).toEqual({
      overnight: 'yes', team_status: 'looking', allergies: 'Peanuts', allergy_severity: 'severe', accessibility: 'Step-free access', looking_for_team: true,
    });
    expect((await myEvent(serviceClient(), email, new Date()))?.profileDone).toBe(true);

    // Opting out on the Team page sticks: saving the same team status again doesn't list them again.
    await f.pool.query('update participants set looking_for_team = false where id = $1', [id]);
    expect(await save({ ...setup, allergies: '', accessibility: '' })).toBe('SAVED');
    expect(await row()).toMatchObject({ allergies: null, allergy_severity: null, accessibility: null, looking_for_team: false });
    expect(await save({ ...setup, teamStatus: 'solo' })).toBe('SAVED');
    expect(await row()).toMatchObject({ team_status: 'solo', looking_for_team: false });
    expect(await save({ ...setup, teamStatus: 'looking' })).toBe('SAVED');
    expect(await row()).toMatchObject({ looking_for_team: true });

    const { rows } = await f.pool.query(`select detail from audit_log where action = 'profile.update' and subject_id = $1`, [id]);
    expect(JSON.stringify(rows)).not.toMatch(/peanut|step-free|severe|sam|555|@/i); // no PII (I-11)
  });

  it('T-ME-10 (v0.11.25): team status follows the team: joining hides Looking, leaving brings it back, the Team page switch moves the answer', async () => {
    const { id } = await f.addParticipant(f.e1.id);
    const email = await emailOf(id);
    const user = { id: f.staff.vol1, email };
    const row = async () => (await f.pool.query('select team_status, looking_for_team from participants where id = $1', [id])).rows[0];
    expect(await saveBadgeProfile(serviceClient(), user, id, { ...contact, overnight: 'no', teamStatus: 'looking' }, { setup: true })).toBe('SAVED');
    const { rows: [team] } = await f.pool.query<{ id: string }>(`insert into teams (event_id, name, join_code) values ($1, 'Status team', 'STTSTMMM') returning id`, [f.e1.id]);
    await f.pool.query('update participants set team_id = $2 where id = $1', [id, team!.id]);
    expect(await row()).toEqual({ team_status: 'looking', looking_for_team: false });
    expect((await myEvent(serviceClient(), email, new Date()))?.teamName).toBe('Status team');
    // Leaving (or being removed) puts someone who was looking back under Looking.
    await f.pool.query('update participants set team_id = null where id = $1', [id]);
    expect(await row()).toEqual({ team_status: 'looking', looking_for_team: true });
    expect((await myEvent(serviceClient(), email, new Date()))?.teamName).toBeNull();
    // The Team page switch keeps the profile answer in step.
    expect(await setLooking(serviceClient(), user, id, false)).toBe('SAVED');
    expect(await row()).toEqual({ team_status: 'solo', looking_for_team: false });
    expect(await setLooking(serviceClient(), user, id, true)).toBe('SAVED');
    expect(await row()).toEqual({ team_status: 'looking', looking_for_team: true });
    // Someone who said "I have a team" and leaves an app team isn't put under Looking.
    await f.pool.query(`update participants set team_status = 'team', team_id = $2 where id = $1`, [id, team!.id]);
    await f.pool.query('update participants set team_id = null where id = $1', [id]);
    expect(await row()).toEqual({ team_status: 'team', looking_for_team: false });
  });

  it('T-ME-05: an attendee saves their own emergency contact and dietary notes; invalid input and other rows change nothing', async () => {
    const { id } = await f.addParticipant(f.e1.id);
    const user = { id: f.staff.vol1, email: (await emailOf(id)).toUpperCase() };
    const save = (participantId: string, input: Parameters<typeof saveBadgeProfile>[3]) =>
      saveBadgeProfile(serviceClient(), user, participantId, input);

    // Saving the dietary notes the Sheet already gave them doesn't take them over from the Sheet (F3).
    expect(await save(id, { dietaryNotes: '' })).toBe('SAVED');
    expect(await details(id)).toMatchObject({ dietary_notes: null, own_dietary: false });
    expect(await save(id, { dietaryNotes: ' Vegan ', ...contact })).toBe('SAVED');
    expect(await details(id)).toEqual({
      dietary_notes: 'Vegan', own_dietary: true, emergency_name: 'Sam Lee', emergency_phone: '+1 416 555 0100', emergency_relation: 'Parent',
    });
    // At the limits, the database checks agree with the app's.
    const limits = { dietaryNotes: 'd'.repeat(500), emergencyName: 'n'.repeat(100), emergencyPhone: '1'.repeat(30), emergencyRelation: 'r'.repeat(60) };
    expect(await save(id, limits)).toBe('SAVED');
    expect(await save(id, { ...contact, emergencyRelation: '' })).toBe('SAVED');
    expect(await details(id)).toMatchObject({ emergency_name: 'Sam Lee', emergency_relation: null });

    const before = await details(id);
    expect(await save(id, { ...contact, emergencyPhone: 'call me' })).toBe('INVALID_CONTACT');
    expect(await save(id, { emergencyName: 'Only A Name' })).toBe('INVALID_CONTACT');
    expect(await save(id, { dietaryNotes: 'd'.repeat(501) })).toBe('INVALID_DIETARY');
    expect(await details(id)).toEqual(before);

    // Someone else's row, a withdrawn attendee's own row, and an event over 30 days ago: refused.
    const b = await details(f.p.B);
    expect(await save(f.p.B, contact)).toBe('NOT_FOUND');
    expect(await details(f.p.B)).toEqual(b);
    const wd = { id: f.staff.vol1, email: await emailOf(f.p.Wd) };
    expect(await saveBadgeProfile(serviceClient(), wd, f.p.Wd, contact)).toBe('NOT_FOUND');
    await f.pool.query(`update events set ends_at = now() - interval '31 days', starts_at = now() - interval '32 days' where id = $1`, [f.e2.id]);
    const x = { id: f.staff.vol1, email: await emailOf(f.p.X) };
    expect(await saveBadgeProfile(serviceClient(), x, f.p.X, contact)).toBe('NOT_FOUND');
    await f.pool.query(`update events set starts_at = now(), ends_at = now() + interval '1 day' where id = $1`, [f.e2.id]);

    const { rows } = await f.pool.query(`select detail from audit_log where action = 'profile.update' and subject_id = $1`, [id]);
    expect(rows).toHaveLength(4);
    expect(JSON.stringify(rows)).not.toMatch(/sam|lee|555|vegan|parent|@/i); // no PII (I-11)
  });

  it('T-ME-06: myEvent returns the event, its schedule and emergency info and your own details, only to an accepted attendee', async () => {
    await f.pool.query(`update events set schedule = $2, emergency_info = $3 where id = $1`, [f.e1.id, 'Doors 9:00\nLunch 12:00', 'Call Ade: 555-0100']);
    const a = await emailOf(f.p.A);
    const now = new Date();
    expect(await myEvent(serviceClient(), ` ${a.toUpperCase()} `, now)).toMatchObject({
      participantId: f.p.A,
      firstName: 'Ada',
      slug: f.slug,
      dietaryNotes: 'Vegetarian',
      emergency: null,
      event: { name: f.e1.name, venue: 'Fixture Hall', schedule: 'Doors 9:00\nLunch 12:00', emergencyInfo: 'Call Ade: 555-0100' },
    });
    expect(await myEvent(serviceClient(), await emailOf(f.p.C), now)).toBeNull(); // waitlisted
    expect(await myEvent(serviceClient(), await emailOf(f.p.Wd), now)).toBeNull(); // withdrawn
    const { id } = await f.addParticipant(f.e1.id);
    const gone = await emailOf(id);
    await f.pool.query('select delete_participant($1, $2, $3)', [f.e1.id, id, f.staff.org1]);
    expect(await myEvent(serviceClient(), gone, now)).toBeNull();
    expect(await myEvent(serviceClient(), a, new Date(Date.now() + 32 * 24 * 3600 * 1000))).toBeNull();
  });

  it('T-ME-06: with two events, /me shows the next one that hasn’t ended, else the most recent', async () => {
    const a = await emailOf(f.p.A);
    await f.pool.query(
      `insert into participants (event_id, external_id, email, first_name, search_text, status, source) values ($1, 'me-06', $2, 'Ada', 'ada', 'accepted', 'sheet')`,
      [f.e2.id, a],
    );
    await f.pool.query(`update events set starts_at = now() + interval '1 day', ends_at = now() + interval '2 days' where id = $1`, [f.e1.id]);
    await f.pool.query(`update events set starts_at = now() + interval '3 days', ends_at = now() + interval '4 days' where id = $1`, [f.e2.id]);
    const slugAt = async (days: number) => (await myEvent(serviceClient(), a, new Date(Date.now() + days * 24 * 3600 * 1000)))?.slug;
    expect(await slugAt(0)).toBe(f.slug); // both upcoming: the earlier one
    expect(await slugAt(1.5)).toBe(f.slug); // E1 under way
    expect(await slugAt(2.5)).toBe(`${f.slug}-2`); // E1 over: E2
    expect(await slugAt(10)).toBe(`${f.slug}-2`); // both over: the most recent
    expect(await slugAt(33)).toBe(`${f.slug}-2`); // E1 out of the 30-day window, E2 still in it
  });
});

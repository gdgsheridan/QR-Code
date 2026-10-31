import { afterAll, beforeAll, expect, it } from 'vitest';
import { saveBadgeProfile, myEvent } from '@/lib/me/profile';
import { serviceClient } from '../fixtures/mail';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
beforeAll(async () => { f = await createStandardFixture(); });
afterAll(async () => { await f.close(); });
const emailOf = async (id: string) => (await f.pool.query<{ email: string }>('select email from participants where id = $1', [id])).rows[0]!.email;
const directory = async (email: string, looking = false, event = f.e1.id) =>
  (await f.pool.query<{ value: Array<Record<string, unknown>> }>('select hacker_directory($1, $2, $3) as value', [event, email, looking])).rows[0]!.value;

it('T-DIR-02: same event accepted undeleted opted-in hackers only; Looking adds names only with no private fields', async () => {
  // Listing is on by default (v0.11.19): start from everyone opted out, then opt in the ones this test needs.
  await f.pool.query('update participants set directory_opt_in = false where event_id = any($1)', [[f.e1.id, f.e2.id]]);
  await f.pool.query(`update participants set directory_opt_in = true, bio = 'Secret bio', pace = 'balanced',
    emergency_name = 'Emergency secret', emergency_phone = '12345' where id = any($1)`, [[f.p.A, f.p.B, f.p.C, f.p.Wd, f.p.X]]);
  await f.pool.query('update participants set looking_for_team = true where id = $1', [f.p.N]);
  const email = await emailOf(f.p.A);
  const rows = await directory(email);
  expect(rows.map((p) => p.id).sort()).toEqual([f.p.A, f.p.B].sort());
  expect(rows.find((p) => p.id === f.p.A)).toEqual({ id: f.p.A, name: 'Ada Fixture', bio: 'Secret bio', pace: 'balanced', teamName: null, looking: false, linkedinUrl: null, discord: null, websiteUrl: null });
  expect((await directory(email, true)).find((p) => p.id === f.p.N)).toEqual({ id: f.p.N, name: 'Nia Fixture' });
  expect(JSON.stringify(rows)).not.toMatch(/email|emergency|phone|dietary|allerg|accessibility|status|Emergency secret/);
  expect(await directory(email, false, f.e2.id)).toEqual([]);
  await f.pool.query('select delete_participant($1, $2, $3)', [f.e1.id, f.p.B, f.staff.org1]);
  expect((await directory(email)).map((p) => p.id)).toEqual([f.p.A]);
});

it('T-DIR-03: waitlisted, withdrawn, unknown viewers cannot read; myEvent refuses them', async () => {
  for (const id of [f.p.C, f.p.Wd]) {
    const email = await emailOf(id);
    expect(await directory(email, true)).toEqual([]);
    expect(await myEvent(serviceClient(), email, new Date())).toBeNull();
  }
  expect(await directory('stranger@example.test')).toEqual([]);
});

it('T-DIR-04: listed by default; own profile only, missing unchanged, blank clears, constraints, no PII audit; tombstone clears', async () => {
  const { id } = await f.addParticipant(f.e1.id);
  const user = { id: f.staff.vol1, email: await emailOf(id) };
  const save = (input: Parameters<typeof saveBadgeProfile>[3], target = id) => saveBadgeProfile(serviceClient(), user, target, input);
  const stored = async () => (await f.pool.query('select directory_opt_in, bio, pace from participants where id = $1', [id])).rows[0];
  expect(await stored()).toEqual({ directory_opt_in: true, bio: null, pace: null }); // v0.11.19: on by default
  expect(await save({ directoryOptIn: true, bio: 'My bio', pace: 'casual' })).toBe('SAVED');
  expect(await save({ bio: 'Forged' }, f.p.A)).toBe('NOT_FOUND');
  expect(await save({ linkedin: '' })).toBe('SAVED');
  expect(await stored()).toEqual({ directory_opt_in: true, bio: 'My bio', pace: 'casual' });
  const audit = await f.pool.query(`select detail from audit_log where subject_id = $1 and action = 'profile.update'`, [id]);
  for (const { detail } of audit.rows) expect(Object.keys(detail).every((key) => ['public', 'directoryOptIn'].includes(key))).toBe(true);
  expect(JSON.stringify(audit.rows)).not.toMatch(/My bio|casual/);
  await expect(f.pool.query("update participants set bio = '' where id = $1", [id])).rejects.toThrow(/check/);
  await expect(f.pool.query("update participants set pace = 'fast' where id = $1", [id])).rejects.toThrow(/check/);
  expect(await save({ bio: '', pace: '', directoryOptIn: false })).toBe('SAVED');
  expect(await stored()).toEqual({ directory_opt_in: false, bio: null, pace: null });
  await save({ directoryOptIn: true, bio: 'My bio', pace: 'competitive' });
  await f.pool.query('select delete_participant($1, $2, $3)', [f.e1.id, id, f.staff.org1]);
  expect(await stored()).toEqual({ directory_opt_in: false, bio: null, pace: null });
});

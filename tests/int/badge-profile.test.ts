import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateToken } from '@/lib/domain/token';
import { saveBadgeProfile } from '@/lib/me/profile';
import { serviceClient } from '../fixtures/mail';
import { passClient } from '../fixtures/pass';
import { createStandardFixture, randomUid, type StandardFixture } from '../fixtures/standard';

// SPEC §6.5 badge profile (public since v0.9, sharing on by default) and PATCH /api/pass (§9.3).
let f: StandardFixture;
beforeAll(async () => {
  f = await createStandardFixture();
});
afterAll(async () => {
  await f.close();
});

type Viewer = { id: string; email: string } | null; // null: signed out (v0.9)
const profileOf = async (uid: string, viewer: Viewer) =>
  (await f.pool.query<{ p: unknown }>('select badge_profile($1, $2, $3) as p', [uid, viewer?.id ?? null, viewer?.email ?? null])).rows[0]?.p ?? null;
const setPublic = (participantId: string, linkedin: string | null) =>
  f.pool.query('update participants set profile_public = true, linkedin_url = $2 where id = $1', [participantId, linkedin]);
const setPrivate = (participantId: string) => f.pool.query('update participants set profile_public = false where id = $1', [participantId]);
// An attendee viewer: signed in (any user id) with the email they registered with.
const attendee = async (participantId: string): Promise<{ id: string; email: string }> => {
  const { rows } = await f.pool.query<{ email: string }>('select email from participants where id = $1', [participantId]);
  return { id: randomUUID(), email: rows[0]?.email ?? '' };
};
const staffViewer = (who: 'org1' | 'vol3'): Viewer => ({ id: f.staff[who], email: f.staffEmail[who] });

describe('badge_profile() (SPEC §6.5)', () => {
  it('T-NFC-12: unlinked → null; not shared → only {allowed, public:false}; shared → name + LinkedIn and nothing else', async () => {
    const b = await attendee(f.p.B);
    expect(await profileOf(randomUid(), b)).toBeNull();
    const { uid } = await f.linkBadge(f.p.A);
    await setPrivate(f.p.A);
    expect(await profileOf(uid, b)).toEqual({ allowed: true, public: false });

    await setPublic(f.p.A, 'https://www.linkedin.com/in/ada-fixture');
    // toEqual: exactly these keys; never email, dietary notes ("Vegetarian"), status or photo.
    expect(await profileOf(uid, b)).toEqual({
      allowed: true,
      public: true,
      firstName: 'Ada',
      lastName: 'Fixture',
      linkedinUrl: 'https://www.linkedin.com/in/ada-fixture',
      discord: null,
      websiteUrl: null,
    });
  });

  it('T-NFC-12: v0.9: anyone may view, signed in or not, and sees the same shared fields', async () => {
    const { id } = await f.addParticipant(f.e1.id);
    const { uid } = await f.linkBadge(id);
    await setPublic(id, 'https://www.linkedin.com/in/someone');
    const shared = await profileOf(uid, staffViewer('org1'));
    expect(shared).toMatchObject({ allowed: true, public: true, linkedinUrl: 'https://www.linkedin.com/in/someone' });
    for (const viewer of [
      null, // signed out
      await attendee(f.p.X), // accepted, but at the other event
      await attendee(f.p.C), // this event, but waitlisted
      staffViewer('vol3'), // staff of the other event
      { id: randomUUID(), email: `stranger-${randomUid()}@example.test` }, // any other account
    ]) {
      expect(await profileOf(uid, viewer), viewer?.email ?? 'signed out').toEqual(shared);
    }
  });

  it('T-NFC-12: a tombstoned participant’s badge shows nothing', async () => {
    const { id } = await f.addParticipant(f.e1.id);
    const { uid } = await f.linkBadge(id);
    await setPublic(id, null);
    expect(await profileOf(uid, staffViewer('org1'))).toMatchObject({ public: true });
    await f.pool.query('select delete_participant($1, $2, $3)', [f.e1.id, id, f.staff.org1]);
    expect(await profileOf(uid, staffViewer('org1'))).toBeNull();
  });

  it('T-NFC-12: a badge reused at a later event shows the newest link, to that event’s people', async () => {
    const uid = randomUid();
    await f.linkBadge(f.p.X, { uid, actor: f.staff.vol3 });
    await setPublic(f.p.X, null);
    expect(await profileOf(uid, staffViewer('vol3'))).toMatchObject({ public: true, firstName: 'Xan' });
    await f.linkBadge(f.p.N, { uid });
    await setPrivate(f.p.N);
    expect(await profileOf(uid, await attendee(f.p.B))).toEqual({ allowed: true, public: false });
    expect(await profileOf(uid, staffViewer('vol3'))).toEqual({ allowed: true, public: false });
  });
});

describe('badge_profile() visibility limits (SPEC §6.5)', () => {
  it('T-NFC-12: a participant who is no longer accepted shows nothing, even if they had opted in', async () => {
    const { id } = await f.addParticipant(f.e1.id);
    const { uid } = await f.linkBadge(id);
    await setPublic(id, 'https://www.linkedin.com/in/someone');
    expect(await profileOf(uid, staffViewer('org1'))).toMatchObject({ public: true });
    await f.pool.query(`update participants set status = 'withdrawn' where id = $1`, [id]);
    expect(await profileOf(uid, staffViewer('org1'))).toBeNull();
  });

  it('T-NFC-12: links from an event that ended more than 30 days ago show nothing', async () => {
    const { rows } = await f.pool.query<{ id: string }>(
      `insert into events (slug, name, venue, starts_at, ends_at)
       values ($1, 'Old Event', 'Old Hall', now() - interval '40 days', now() - interval '31 days') returning id`,
      [`${f.slug}-old`],
    );
    const oldEvent = rows[0]?.id ?? '';
    const { id } = await f.addParticipant(oldEvent);
    const { uid } = await f.linkBadge(id);
    await setPublic(id, null);
    const self = await attendee(id);
    expect(await profileOf(uid, self)).toBeNull();
    await f.pool.query(`update events set ends_at = now() - interval '29 days' where id = $1`, [oldEvent]);
    expect(await profileOf(uid, self)).toMatchObject({ allowed: true, public: true });
  });
});

describe('badge_profile() for the badge holder (SPEC F14, v0.6)', () => {
  it('T-NFC-22: the holder tapping their own badge also gets self + the event slug (for their menu); nobody else does', async () => {
    const { id } = await f.addParticipant(f.e1.id);
    const { uid } = await f.linkBadge(id);
    await setPrivate(id);
    const self = await attendee(id);
    if (!self) throw new Error('no viewer');
    expect(await profileOf(uid, { ...self, email: self.email.toUpperCase() })).toEqual({ allowed: true, public: false, self: true, slug: f.slug });
    await setPublic(id, null);
    expect(await profileOf(uid, self)).toMatchObject({ allowed: true, public: true, self: true, slug: f.slug });
    for (const viewer of [await attendee(f.p.B), staffViewer('org1'), await attendee(f.p.X), null]) {
      const p = (await profileOf(uid, viewer)) as Record<string, unknown>;
      expect(p).not.toHaveProperty('self');
      expect(p).not.toHaveProperty('slug');
    }
  });
});

describe('sharing on by default (SPEC §6.5, v0.9)', () => {
  it('T-NFC-24: new participants share by default; the migration switched on only people who never saw the choice (no answer, setting, claim or pass)', async () => {
    const { id } = await f.addParticipant(f.e1.id);
    expect((await f.pool.query('select profile_public from participants where id = $1', [id])).rows).toEqual([{ profile_public: true }]);
    // The backfill's rule, replayed on rows made private again: only those without an answer or a saved setting flip.
    // [untouched, answered an RSVP, saved their profile, toggled sharing on the pass page, claimed a badge, holds a pass]
    const ids = await Promise.all([0, 1, 2, 3, 4, 5].map(async (i) => (await f.addParticipant(f.e1.id, { withPass: i === 5 })).id));
    for (const [i, action] of [[1, 'rsvp.yes'], [2, 'profile.update'], [3, 'profile.visibility'], [4, 'badge.claim']] as const) {
      await f.pool.query(`insert into audit_log (event_id, actor_kind, action, subject_id) values ($1, 'participant', $2, $3)`, [f.e1.id, action, ids[i]]);
    }
    await f.pool.query('update participants set profile_public = false where id = any($1)', [ids]);
    const file = readdirSync('supabase/migrations').find((n) => n.endsWith('_public_badges.sql')) ?? '';
    const backfill = /update participants pa set profile_public = true[\s\S]+?;/.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))?.[0] ?? '';
    expect(backfill).not.toBe('');
    await f.pool.query(backfill.replace('where not pa.profile_public', 'where pa.id = any($1) and not pa.profile_public'), [ids]);
    const { rows } = await f.pool.query<{ id: string; profile_public: boolean }>('select id, profile_public from participants where id = any($1)', [ids]);
    const shared = Object.fromEntries(rows.map((r) => [r.id, r.profile_public]));
    expect(ids.map((pid) => shared[pid])).toEqual([true, false, false, false, false, false]);
  });
});

describe('Discord and website on the badge profile (SPEC §6.5, v0.9.2)', () => {
  it('T-NFC-26: saved normalized, shown only while shared, cleared by blank, refused when invalid, gone with the tombstone', async () => {
    const { id } = await f.addParticipant(f.e1.id);
    const { uid } = await f.linkBadge(id);
    const { rows } = await f.pool.query<{ email: string }>('select email from participants where id = $1', [id]);
    const user = { id: f.staff.vol1, email: rows[0]?.email ?? '' }; // any account; the email is what matches
    const save = (input: Parameters<typeof saveBadgeProfile>[3]) => saveBadgeProfile(serviceClient(), user, id, input);
    const stored = async () =>
      (await f.pool.query('select discord_username, website_url from participants where id = $1', [id])).rows[0];

    expect(await save({ discord: ' @Ada.Codes ', website: 'ada.dev', profilePublic: true })).toBe('SAVED');
    expect(await stored()).toEqual({ discord_username: 'ada.codes', website_url: 'https://ada.dev/' });
    expect(await profileOf(uid, null)).toMatchObject({ public: true, discord: 'ada.codes', websiteUrl: 'https://ada.dev/' });
    const audit = await f.pool.query<{ detail: unknown }>(
      `select detail from audit_log where subject_id = $1 and action = 'profile.update' order by id desc limit 1`,
      [id],
    );
    expect(JSON.stringify(audit.rows[0]?.detail)).not.toMatch(/ada/); // I-11: at most the sharing flag

    await setPrivate(id);
    expect(await profileOf(uid, null)).toEqual({ allowed: true, public: false });

    expect(await save({ discord: 'ada#1234' })).toBe('INVALID_DISCORD');
    expect(await save({ website: 'javascript:alert(1)' })).toBe('INVALID_WEBSITE');
    expect(await stored()).toEqual({ discord_username: 'ada.codes', website_url: 'https://ada.dev/' });
    expect(await save({ linkedin: '' })).toBe('SAVED'); // a missing key leaves them as they are
    expect(await stored()).toEqual({ discord_username: 'ada.codes', website_url: 'https://ada.dev/' });

    expect(await save({ discord: '', website: ' ' })).toBe('SAVED');
    expect(await stored()).toEqual({ discord_username: null, website_url: null });

    // The database refuses what the parser would: integrity lives in the checks.
    await expect(f.pool.query(`update participants set discord_username = 'Ada Codes' where id = $1`, [id])).rejects.toThrow(/check/);
    await expect(f.pool.query(`update participants set website_url = 'javascript:alert(1)' where id = $1`, [id])).rejects.toThrow(/check/);

    await save({ discord: 'ada.codes', website: 'ada.dev' });
    await f.pool.query('select delete_participant($1, $2, $3)', [f.e1.id, id, f.staff.org1]);
    expect(await stored()).toEqual({ discord_username: null, website_url: null });
  });
});

describe('PATCH /api/pass (SPEC §9.3)', () => {
  it('T-NFC-13: an active token sets the opt-in, audits it without PII, and the pass page reflects it', async () => {
    const c = passClient();
    const res = await c.patch({ token: f.token.B, profilePublic: true });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ profile: { public: true, hasLinkedin: false } });
    const row = await f.pool.query('select profile_public from participants where id = $1', [f.p.B]);
    expect(row.rows).toEqual([{ profile_public: true }]);
    const audit = await f.pool.query(
      `select actor_kind, actor_user_id, detail from audit_log where action = 'profile.visibility' and subject_id = $1`,
      [f.p.B],
    );
    expect(audit.rows).toEqual([{ actor_kind: 'participant', actor_user_id: null, detail: { public: true } }]);
    // v0.11.25: the pass page shows their links only while they share them.
    expect(await (await c.lookup({ token: f.token.B })).json()).toMatchObject({ links: { linkedinUrl: null } });

    expect(await (await c.patch({ token: f.token.B, profilePublic: false })).json()).toEqual({ profile: { public: false, hasLinkedin: false } });
    expect(await (await c.lookup({ token: f.token.B })).json()).toMatchObject({ links: null });
  });

  it('T-NFC-13: replaced, cancelled and unknown tokens → 404 and nothing changes; a bad body → 400', async () => {
    const c = passClient();
    const before = (await f.pool.query('select profile_public from participants where id = any($1) order by id', [[f.p.Rv, f.p.Wd]])).rows;
    for (const token of [f.rvOldToken, f.token.Wd, generateToken()]) {
      const res = await c.patch({ token, profilePublic: true });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ state: 'not_found' });
    }
    const rows = await f.pool.query('select profile_public from participants where id = any($1) order by id', [[f.p.Rv, f.p.Wd]]);
    expect(rows.rows).toEqual(before);
    expect((await c.patch({ token: f.token.N, profilePublic: true, extra: 1 })).status).toBe(400);
    expect((await c.patch({ token: f.token.N, profilePublic: 'yes' })).status).toBe(400);
    expect((await c.patch({ token: f.token.N })).status).toBe(400);
  });
});

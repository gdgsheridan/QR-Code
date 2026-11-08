import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCateringShareHandler } from '@/lib/admin/catering';
import { adminClient, obj } from '../fixtures/admin-api';
import { requireEnv } from '../fixtures/db';
import { serviceClient } from '../fixtures/mail';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
let org: string;
let vol: string;
const c = adminClient();
const secret = requireEnv('PASS_TOKEN_SECRET');
const share = (body: unknown, now?: () => Date) =>
  createCateringShareHandler({ db: serviceClient(), passSecret: secret, ...(now && { now }) })(
    new Request('http://localhost/api/catering', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
      body: JSON.stringify(body),
    }),
  );
const keyOf = (url: string) => url.slice(url.indexOf('#') + 1);
const flip = (token: string) => (token.startsWith('A') ? 'B' : 'A') + token.slice(1);

beforeAll(async () => {
  f = await createStandardFixture();
  [org, vol] = await Promise.all([signInAs(f.staffEmail.org1), signInAs(f.staffEmail.vol1)]);
  await f.pool.query(`update participants set allergies = 'Peanuts', allergy_severity = 'severe' where id = $1`, [f.p.A]);
});
afterAll(async () => {
  await f.close();
});

describe('Catering share link (SPEC §11, v0.11.39)', () => {
  it('T-ANA-08: an organizer makes a link, anyone holding it reads the Catering list, and Reset link kills the old one', async () => {
    expect(obj((await c.call('catering', org, { slug: f.slug })).body).shareUrl).toBeNull();
    expect((await c.call('cateringLink', vol, { slug: f.slug }, { method: 'POST' })).status).toBe(403);

    const made = await c.call('cateringLink', org, { slug: f.slug }, { method: 'POST' });
    expect(made.status).toBe(200);
    const url = String(obj(made.body).shareUrl);
    // The key rides in the fragment only, never in the path or query (I-3's rule for every link key).
    expect(url).toMatch(new RegExp(`^http://localhost:3100/catering/${f.slug}#[A-Za-z0-9_-]{32}$`));
    expect(obj((await c.call('catering', org, { slug: f.slug })).body).shareUrl).toBe(url);
    const { rows: audit } = await f.pool.query(`select detail from audit_log where event_id = $1 and action = 'catering.link'`, [f.e1.id]);
    expect(audit).toEqual([{ detail: {} }]);
    const { rows: [stored] } = await f.pool.query<{ catering_link_id: string }>(`select catering_link_id from events where id = $1`, [f.e1.id]);
    expect(JSON.stringify(stored)).not.toContain(keyOf(url)); // only the random id is stored, never the key

    const token = keyOf(url);
    const ok = await share({ slug: f.slug, token });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    const body = obj(await ok.json());
    expect(body.event).toEqual({ name: f.e1.name });
    expect(body.hackers).toEqual(obj((await c.call('catering', org, { slug: f.slug })).body).hackers);
    expect((body.hackers as Array<{ name: string }>).map((h) => h.name)).toEqual(['Ada Fixture', 'Ben Fixture', 'Nia Fixture', 'Rae Fixture']);
    for (const hacker of body.hackers as Array<Record<string, unknown>>) {
      expect(Object.keys(hacker).sort()).toEqual(['allergies', 'allergySeverity', 'dietaryNotes', 'name']);
    }
    expect(JSON.stringify(body)).not.toContain('@'); // no emails

    // A wrong key, another event (with or without its own link), an unknown slug: the same 404. Bad bodies: 400.
    expect((await share({ slug: f.slug, token: flip(token) })).status).toBe(404);
    expect((await share({ slug: `${f.slug}-2`, token })).status).toBe(404);
    await c.call('cateringLink', org, { slug: f.slug }, { method: 'POST' });
    const fresh = keyOf(String(obj((await c.call('catering', org, { slug: f.slug })).body).shareUrl));
    expect(fresh).not.toBe(token);
    expect(await (await share({ slug: f.slug, token })).json()).toEqual({ state: 'not_found' }); // reset: the old link is dead
    expect((await share({ slug: f.slug, token: fresh })).status).toBe(200);
    expect((await share({ slug: 'no-such-event', token: fresh })).status).toBe(404);
    expect((await share({ slug: f.slug, token: fresh, extra: 1 })).status).toBe(400);
    expect((await share({ slug: f.slug })).status).toBe(400);

    // Dead 30 days after the event ends, when retention deletes the dietary notes (§15).
    const day = 24 * 3600 * 1000;
    const { rows: [ev] } = await f.pool.query<{ ends_at: Date }>(`select ends_at from events where id = $1`, [f.e1.id]);
    const end = new Date(ev?.ends_at ?? 0).getTime();
    expect((await share({ slug: f.slug, token: fresh }, () => new Date(end + 29 * day))).status).toBe(200);
    expect((await share({ slug: f.slug, token: fresh }, () => new Date(end + 31 * day))).status).toBe(404);

    // 30 a minute per link, like /api/pass (§15).
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await share({ slug: f.slug, token: fresh })).status);
    expect(statuses.at(-1)).toBe(429);
  });
});

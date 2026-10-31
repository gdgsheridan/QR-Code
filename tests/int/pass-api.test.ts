import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateToken } from '@/lib/domain/token';
import { passClient } from '../fixtures/pass';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';
import { awaitFreshWindow } from '../fixtures/window';

let f: StandardFixture;
let c: ReturnType<typeof passClient>;
beforeEach(async () => {
  f = await createStandardFixture();
  c = passClient();
});
afterEach(async () => {
  await f.close();
});

describe('POST /api/pass (SPEC F5)', () => {
  it('T-PASS-01: an active token returns the pass holder, event, team and shared links; never dietary notes or email', async () => {
    const res = await c.lookup({ token: f.token.A });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toEqual({
      state: 'active',
      firstName: 'Ada',
      lastName: 'Fixture',
      event: { name: f.e1.name, venue: 'Fixture Hall', startsAt: expect.any(String), timezone: 'America/Toronto' },
      team: null,
      links: { linkedinUrl: null, discord: null, websiteUrl: null }, // shared: badge profile on by default since v0.9
    });
    await f.checkIn(f.p.A, f.token.A);
    expect(await (await c.lookup({ token: f.token.A })).json()).toEqual(body);

    // v0.11.25: the pass shows their team and track, and the links they share on their badge.
    const { rows: [track] } = await f.pool.query<{ id: string }>(`insert into tracks (event_id, name) values ($1, 'Best AI') returning id`, [f.e1.id]);
    const { rows: [team] } = await f.pool.query<{ id: string }>(
      `insert into teams (event_id, name, join_code, track_id) values ($1, 'Byte Club', 'ABCDEFGH', $2) returning id`, [f.e1.id, track?.id]);
    await f.pool.query(
      `update participants set team_id = $2, linkedin_url = 'https://www.linkedin.com/in/ada', discord_username = 'ada.codes',
              website_url = 'https://ada.dev/', dietary_notes = 'Vegan' where id = $1`, [f.p.A, team?.id]);
    const shared = await (await c.lookup({ token: f.token.A })).json();
    expect(shared).toMatchObject({
      team: { name: 'Byte Club', track: 'Best AI' },
      links: { linkedinUrl: 'https://www.linkedin.com/in/ada', discord: 'ada.codes', websiteUrl: 'https://ada.dev/' },
    });
    expect(JSON.stringify(shared)).not.toMatch(/Vegan|@/);
    // Not shared on the badge: no links, since anyone who scans the QR opens this page.
    await f.pool.query('update participants set profile_public = false where id = $1', [f.p.A]);
    expect(await (await c.lookup({ token: f.token.A })).json()).toMatchObject({ team: { name: 'Byte Club' }, links: null });
  });

  it('T-PASS-02: a garbage token and an unknown well-formed token get the identical generic response', async () => {
    const garbage = await c.lookup({ token: 'not a token!' });
    const unknown = await c.lookup({ token: generateToken() });
    expect(garbage.status).toBe(404);
    expect(unknown.status).toBe(404);
    const [a, b] = [await garbage.text(), await unknown.text()];
    expect(a).toBe(b);
    expect(JSON.parse(a)).toEqual({ state: 'not_found' });
  });

  it('T-PASS-03: rotated token → replaced; revoked (withdrawn) token → cancelled', async () => {
    const replaced = await c.lookup({ token: f.rvOldToken });
    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toEqual({ state: 'replaced' });
    expect(await (await c.lookup({ token: f.token.Wd })).json()).toEqual({ state: 'cancelled' });
  });

  it('F5: a malformed body is 400 (.strict() schema)', async () => {
    expect((await c.lookup({ token: 5 })).status).toBe(400);
    expect((await c.lookup({ token: f.token.A, extra: 1 })).status).toBe(400);
    expect((await c.lookup('{nope')).status).toBe(400);
  });

  it('§15 (v0.11.25): /api/pass allows 30 requests per minute per pass, and 600 per IP, so a venue sharing one IP still works', async () => {
    await awaitFreshWindow(60);
    // A whole venue behind one IP: 40 different passes all answer (unknown ones 404, never 429).
    const venue: number[] = [];
    for (let i = 0; i < 40; i++) venue.push((await c.lookup({ token: generateToken() })).status);
    expect(venue.every((s) => s === 404)).toBe(true);
    // One pass hammered: the 31st request in a minute is refused, from any IP.
    const hammered = generateToken();
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await passClient().lookup({ token: hammered })).status);
    expect(statuses.slice(0, 30).every((s) => s === 404)).toBe(true);
    expect(statuses[30]).toBe(429);
    expect((await c.lookup({ token: f.token.A })).status).toBe(200);
    // The per-IP ceiling still stops a scraper.
    const scraper = passClient();
    const results: number[] = [];
    for (let sent = 0; sent < 601; sent += 20) {
      results.push(...(await Promise.all(Array.from({ length: Math.min(20, 601 - sent) }, () => scraper.lookup({ token: generateToken() }).then((r) => r.status)))));
    }
    expect(results.filter((s) => s === 429)).toHaveLength(1);
  });

  it('§15: the rate-limit key stores a hash, never the raw IP (I-11)', async () => {
    await c.lookup({ token: f.token.A });
    const { rows } = await f.pool.query<{ n: number }>('select count(*)::int as n from rate_limits where key like $1', [`%${c.ip}%`]);
    expect(rows[0]?.n).toBe(0);
  });
});

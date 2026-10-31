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
  it('T-PASS-01: an active token returns their name and event; nothing else about the person', async () => {
    const res = await c.lookup({ token: f.token.A });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toEqual({
      state: 'active',
      firstName: 'Ada',
      lastName: 'Fixture', // v0.11.27: the pass shows the full name
      event: { name: f.e1.name, venue: 'Fixture Hall', startsAt: expect.any(String), timezone: 'America/Toronto' },
      profile: { public: true, hasLinkedin: false }, // §6.5 badge profile: on by default since v0.9
    });
    await f.checkIn(f.p.A, f.token.A);
    expect(await (await c.lookup({ token: f.token.A })).json()).toEqual(body);
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

  it('§15: /api/pass allows 30 requests per minute per IP, then 429', async () => {
    await awaitFreshWindow(60);
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await c.lookup({ token: generateToken() })).status);
    expect(statuses.slice(0, 30).every((s) => s === 404)).toBe(true);
    expect(statuses[30]).toBe(429);
    const other = passClient();
    expect((await other.lookup({ token: f.token.A })).status).toBe(200);
  });

  it('§15: the rate-limit key stores a hash, never the raw IP (I-11)', async () => {
    await c.lookup({ token: f.token.A });
    const { rows } = await f.pool.query<{ n: number }>('select count(*)::int as n from rate_limits where key like $1', [`%${c.ip}%`]);
    expect(rows[0]?.n).toBe(0);
  });
});

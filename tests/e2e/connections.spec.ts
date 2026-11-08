import { expect, test } from '@playwright/test';
import { E2E_ORIGIN, signIn } from '../fixtures/e2e';
import { createAccount, createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC F17 (v0.12): Connect on a badge page; it counts once both have tapped; /me links Connections.
let f: StandardFixture;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  f = await createStandardFixture();
});
test.afterAll(async () => {
  await f.close();
});

const emailOf = async (participantId: string) =>
  (await f.pool.query<{ email: string }>('select email from participants where id = $1', [participantId])).rows[0]?.email ?? '';

test('T-CONN-06: A connects on B’s badge, B connects back, both see each other on /me; a badge tap connects with no button, a plain link doesn’t; signed out sees no connect; a listed hacker’s bio shows to everyone (v0.12.4)', async ({ browser }) => {
  await f.checkIn(f.p.A);
  await f.checkIn(f.p.B);
  const { uid: aBadge } = await f.linkBadge(f.p.A);
  const { uid: bBadge } = await f.linkBadge(f.p.B);
  await f.pool.query(`update participants set linkedin_url = 'https://www.linkedin.com/in/ben-fixture', profile_public = true where id = $1`, [f.p.B]);
  // v0.12.4: his directory bio shows on his badge page while he is listed in the directory (F16).
  await f.pool.query(`update participants set bio = $2, directory_opt_in = true where id = $1`, [f.p.B, 'I build <b>quokkabots</b>\nand drink tea']);

  const anon = await browser.newContext({ baseURL: E2E_ORIGIN });
  const anonPage = await anon.newPage();
  await anonPage.goto(`/profile/${bBadge}?tap`);
  await expect(anonPage.getByText('Ben')).not.toHaveCount(0); // the profile itself is shown
  await expect(anonPage.getByRole('link', { name: /Sign in/ })).toHaveCount(0); // owner's request: no Sign in to connect
  await expect(anonPage.getByRole('button', { name: /Connect/ })).toHaveCount(0);
  // v0.12.4 (owner's decision): a listed hacker's bio shows to anyone tapping the badge, signed out too (escaped, line kept).
  await expect(anonPage.getByTestId('badge-bio')).toHaveText('I build <b>quokkabots</b>\nand drink tea', { useInnerText: true });
  await expect(anonPage.getByRole('link', { name: '← My menu' })).toHaveCount(0); // the way back is for signed-in hackers
  await expect(anonPage.getByTestId('connect-burst')).toHaveCount(0);
  await anon.close();

  const a = await browser.newContext({ baseURL: E2E_ORIGIN });
  const aPage = await a.newPage();
  await createAccount(await emailOf(f.p.A));
  await signIn(aPage, await emailOf(f.p.A), `/profile/${bBadge}`); // a plain link, not a badge tap
  await expect(aPage.getByTestId('badge-bio')).toHaveText('I build <b>quokkabots</b>\nand drink tea', { useInnerText: true }); // escaped, line kept
  await f.pool.query(`update participants set profile_public = false where id = $1`, [f.p.B]);
  await aPage.reload();
  await expect(aPage.getByTestId('badge-bio')).toHaveCount(0); // a private badge stays nameless and bio-less
  await f.pool.query(`update participants set profile_public = true, directory_opt_in = false where id = $1`, [f.p.B]);
  await aPage.reload();
  await expect(aPage.getByRole('heading', { name: 'Ben Fixture' })).toBeVisible();
  await expect(aPage.getByTestId('badge-bio')).toHaveCount(0); // not listed in the directory: no bio
  // v0.12.4 (owner's request): no Connect button; a plain link connects nobody, a badge tap (?tap) connects.
  await expect(aPage.getByRole('link', { name: '← My menu' })).toHaveAttribute('href', '/me');
  await expect(aPage.getByText('Tap Ben’s badge with your phone to connect.')).toBeVisible();
  await expect(aPage.getByRole('button', { name: /Connect/ })).toHaveCount(0);
  const taps = async () => (await f.pool.query('select from_participant_id from connection_taps where event_id = $1', [f.e1.id])).rows.length;
  expect(await taps()).toBe(0);
  await expect(aPage.getByTestId('connect-burst')).toHaveCount(0);
  await aPage.goto(`/profile/${bBadge}?tap`);
  await expect(aPage.getByTestId('connect-burst')).toHaveAttribute('data-kind', 'sent'); // the special one, this tap only
  await expect(aPage.getByText(/Sent! It counts/)).toHaveCount(0); // owner's request: the chip says it
  await aPage.reload(); // a refresh doesn't tap again, or replay it
  await expect(aPage.getByTestId('connect-burst')).toHaveCount(0);
  expect(await taps()).toBe(1);

  const b = await browser.newContext({ baseURL: E2E_ORIGIN });
  const bPage = await b.newPage();
  await createAccount(await emailOf(f.p.B));
  await signIn(bPage, await emailOf(f.p.B), `/profile/${aBadge}`);
  await expect(bPage.getByText('Ada tapped your badge. Tap theirs with your phone to connect back.')).toBeVisible();
  await bPage.goto(`/profile/${aBadge}?tap`); // Ben taps Ada's badge back
  await expect(bPage.getByTestId('connect-burst')).toHaveAttribute('data-kind', 'mutual');
  await expect(bPage.getByRole('status').filter({ hasText: '✓ You’re connected with Ada.' })).toHaveClass(/sr-only/); // for screen readers only
  await expect(bPage.getByText('+1 connection')).toBeVisible();
  expect(await taps()).toBe(2);

  // A's menu: the Connections row counts it; the page lists Ben with his shared LinkedIn.
  await aPage.goto('/me');
  const row = aPage.getByRole('navigation', { name: 'Hacker menu' }).getByRole('link', { name: /^Connections/ });
  await expect(row).toContainText('1 connection · #1 on the leaderboard');
  await row.click();
  await expect(aPage.getByRole('heading', { name: 'Connections', level: 1 })).toBeVisible();
  await expect(aPage.getByText('1 connection', { exact: true })).toBeVisible();
  await expect(aPage.getByRole('link', { name: 'Ben Fixture', exact: true })).toHaveAttribute('href', `/profile/${bBadge}`);
  await expect(aPage.getByRole('link', { name: 'LinkedIn: Ben Fixture' })).toHaveAttribute('href', 'https://www.linkedin.com/in/ben-fixture');
  await a.close();
  await b.close();
});

import { expect, test } from '@playwright/test';
import { chooseCheckpoint, E2E_ORIGIN, fakeCameraArgs, signIn } from '../fixtures/e2e';
import { createAccount, createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC F14 step 8 and §8 step 11b: a hacker's Workshops page lists the workshops their badge was tapped at, with
// the cooldown; the scanner refuses a second workshop inside it. No stubs: both go through the real API and database.
let f: StandardFixture;
let pandas = '';
test.describe.configure({ mode: 'serial' });
test.use({ launchOptions: { args: fakeCameraArgs() } });
test.beforeAll(async () => {
  f = await createStandardFixture();
  const { rows } = await f.pool.query<{ id: string }>(
    `insert into checkpoints (event_id, name, kind, requires_checkin, is_open) values ($1, 'Intro to Pandas', 'session', true, true) returning id`,
    [f.e1.id],
  );
  pandas = rows[0]?.id ?? '';
});
test.afterAll(async () => {
  await f.close();
});

test('T-WS-03: the menu counts workshops; the page lists them newest first with the cooldown timer', async ({ browser }) => {
  await f.checkIn(f.p.A);
  const { uid } = await f.linkBadge(f.p.A);
  expect((await f.badgeScan({ cp: pandas, staff: f.staff.vol1, uid })).code).toBe('ACCEPTED');
  expect((await f.badgeScan({ cp: f.cp.W, staff: f.staff.vol1, uid })).code).toBe('SESSION_COOLDOWN');

  const email = (await f.pool.query<{ email: string }>('select email from participants where id = $1', [f.p.A])).rows[0]?.email ?? '';
  await createAccount(email);
  const ctx = await browser.newContext({ baseURL: E2E_ORIGIN });
  const page = await ctx.newPage();
  await signIn(page, email, '/me');
  const row = page.getByRole('navigation', { name: 'Hacker menu' }).getByRole('link', { name: /^Workshops/ });
  await expect(row).toContainText('1 attended');
  await row.click();
  await expect(page.getByRole('heading', { name: '1 workshop attended' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Intro to Pandas' })).toContainText(/(EDT|EST)$/);
  const timer = page.getByTestId('cooldown-timer');
  await expect(timer).toHaveText(/^[45]:\d\d$/);
  const before = await timer.textContent();
  await expect.poll(() => timer.textContent(), { timeout: 5000 }).not.toBe(before); // it ticks

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await ctx.close();
});

test('T-WS-05: the real scanner: a second workshop inside the cooldown is amber COOLDOWN with a ticking timer, tap to dismiss, nothing recorded', async ({ browser }) => {
  await f.checkIn(f.p.B);
  expect((await f.scan({ cp: pandas, staff: f.staff.vol2, participantId: f.p.B })).code).toBe('ACCEPTED');
  const ctx = await browser.newContext({ baseURL: E2E_ORIGIN, permissions: ['camera'] });
  const page = await ctx.newPage();
  await signIn(page, f.staffEmail.vol1, `/scan/${f.slug}`);
  await chooseCheckpoint(page, 'Workshop');
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'ready');
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('ben');
  await page.getByRole('button', { name: 'Record scan for Ben Fixture' }).click();

  const result = page.getByTestId('scan-result');
  await expect(result).toHaveAttribute('data-tone', 'amber');
  await expect(result).toContainText('COOLDOWN');
  await expect(result).toContainText('Ben Fixture');
  const timer = result.getByTestId('cooldown-timer');
  await expect(timer).toHaveText(/^Next workshop in [45]:\d\d$/);
  const before = await timer.textContent();
  await expect.poll(() => timer.textContent(), { timeout: 5000 }).not.toBe(before);
  await expect(result).toHaveAttribute('data-dismiss', 'tap');
  await page.waitForTimeout(3000); // only green auto-dismisses
  await expect(result).toBeVisible();
  await result.click();
  await expect(result).toBeHidden();
  const { rows } = await f.pool.query('select 1 from scans where participant_id = $1 and checkpoint_id = $2', [f.p.B, f.cp.W]);
  expect(rows).toEqual([]);
  await ctx.close();
});

import { expect, test, type Page } from '@playwright/test';
import { signIn } from '../fixtures/e2e';
import { createAccount, createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC §15 (v0.11.46): wheel scrolling glides (Lenis) on the attendee pages only, never under reduced motion.
let f: StandardFixture;
test.beforeAll(async () => { f = await createStandardFixture(); });
test.afterAll(async () => { await f?.close(); });

const emailOf = async (id: string) => (await f.pool.query<{ email: string }>('select email from participants where id = $1', [id])).rows[0]?.email ?? '';
const scrollY = (page: Page) => page.evaluate(() => window.scrollY);
// Next adds its route announcer once the page has hydrated, so a missing class then is a real absence.
const hydrated = (page: Page) => page.locator('next-route-announcer').waitFor({ state: 'attached' });

test('T-UI-08: wheel scrolling glides on attendee pages and a navigation lands at the top; reduced motion scrolls natively', async ({ page, browser }) => {
  // Enough hackers that the directory scrolls.
  await f.pool.query(
    `insert into participants (event_id, email, first_name, last_name, search_text, status, source, directory_opt_in)
     select $1, 'glide' || g || '-' || $2 || '@example.test', 'Glide', 'Hacker' || g, 'glide hacker' || g, 'accepted', 'seed', true
       from generate_series(1, 30) g`, [f.e1.id, f.slug]);
  const email = await emailOf(f.p.A);
  await createAccount(email);
  await signIn(page, email, '/me/hackers');
  const html = page.locator('html');
  await expect(html).toHaveClass(/(^|\s)lenis(\s|$)/);
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 800);
  await expect(html).toHaveClass(/lenis-smooth/); // Lenis animates the scroll instead of jumping
  await expect(html).not.toHaveClass(/lenis-scrolling/, { timeout: 5000 });
  expect(await scrollY(page)).toBeGreaterThan(400);

  // A navigation lands at the top of the next page instead of gliding on toward the old target.
  await page.getByRole('link', { name: '← Menu' }).click();
  await page.waitForURL(/\/me$/);
  await expect.poll(() => scrollY(page)).toBe(0);
  await page.waitForTimeout(400);
  expect(await scrollY(page)).toBe(0);

  const still = await browser.newContext({ storageState: await page.context().storageState(), reducedMotion: 'reduce', baseURL: page.url() });
  const stillPage = await still.newPage();
  await stillPage.goto('/me/hackers');
  await hydrated(stillPage);
  await expect(stillPage.locator('html')).not.toHaveClass(/lenis/);
  await still.close();
  await f.pool.query(`delete from participants where event_id = $1 and email like 'glide%'`, [f.e1.id]);
});

test('T-UI-08: staff pages keep native scrolling', async ({ page }) => {
  await signIn(page, f.staffEmail.org1, '/me');
  await expect(page.locator('html')).toHaveClass(/(^|\s)lenis(\s|$)/); // /me is an attendee page, even for staff
  await page.goto(`/admin/${f.slug}`);
  await hydrated(page);
  await expect(page.locator('html')).not.toHaveClass(/lenis/);
  await page.goto(`/scan/${f.slug}`);
  await hydrated(page);
  await expect(page.locator('html')).not.toHaveClass(/lenis/);
});

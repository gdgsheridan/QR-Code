import { expect, test } from '@playwright/test';
import { signIn } from '../fixtures/e2e';
import { createAccount, createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC §15 Planet: the ringed planet behind the attendee pages, its bands swaying through a 12-frame sprite.
let f: StandardFixture;
test.beforeAll(async () => { f = await createStandardFixture(); });
test.afterAll(async () => { await f?.close(); });

const FRAMES = 12;

test('T-UI-09: the planet sits behind attendee pages, its sprite steps through its frames, still with reduced motion, absent on passes and staff pages, and no page scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const email = (await f.pool.query<{ email: string }>('select email from participants where id = $1', [f.p.A])).rows[0]?.email;
  if (!email) throw new Error('Fixture participant must have an email');
  await createAccount(email);
  await signIn(page, email, '/me');
  const planet = page.locator('[data-planet]');
  await expect(planet).toBeVisible();
  // Decorative and behind the content: hidden from screen readers, never in the way of a pointer.
  await expect(planet).toHaveAttribute('aria-hidden', 'true');
  await expect(planet).toHaveCSS('pointer-events', 'none');
  await expect(planet).toHaveCSS('z-index', '-3');
  await expect(planet).toHaveCSS('background-image', /\/planet-sprite\.webp/);
  expect(await planet.evaluate(async (el) => {
    const sprite = new Image();
    sprite.src = getComputedStyle(el).backgroundImage.slice(5, -2);
    await sprite.decode();
    return [sprite.naturalWidth, sprite.naturalHeight];
  })).toEqual([FRAMES * 640, 399]);
  // Partly off the bottom-right corner.
  const box = await planet.boundingBox();
  expect(box && box.x + box.width > 1440 && box.y + box.height > 900 && box.x < 1440 && box.y < 900).toBe(true);

  // The sprite steps: background-position lands on whole frames (k / 11 of 100%) and changes over time.
  const position = () => planet.evaluate((el) => parseFloat(getComputedStyle(el).backgroundPositionX));
  const seen = new Set<number>();
  for (let i = 0; i < 12; i++) {
    const at = await position();
    expect(Math.abs(at * (FRAMES - 1) / 100 - Math.round(at * (FRAMES - 1) / 100))).toBeLessThan(0.01);
    seen.add(Math.round(at * (FRAMES - 1) / 100));
    await page.waitForTimeout(250);
  }
  expect(seen.size).toBeGreaterThan(3);

  // No sideways scroll on the attendee pages, at a desktop and a phone width.
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/me', '/me/profile', '/me/schedule', '/me/hackers', '/me/emergency', '/rsvp']) {
      await page.goto(route);
      await expect(page.getByRole('main')).toBeVisible();
      await expect(planet).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${route} at ${width}px`).toBe(true);
    }
  }

  // Reduced motion: frame 1, still.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/me');
  await expect(planet).toBeVisible();
  expect(await planet.evaluate((el) => el.getAnimations().length)).toBe(0);
  expect(await position()).toBe(0);
  await page.waitForTimeout(600);
  expect(await position()).toBe(0);

  // Never on the pass page or staff pages, whatever the motion setting.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/p');
  await expect(page.getByRole('main')).toBeVisible();
  await expect(planet).toHaveCount(0);
  await signIn(page, f.staffEmail.org1, `/admin/${f.slug}`);
  await expect(page.getByRole('navigation', { name: 'Admin' })).toBeVisible();
  await expect(planet).toHaveCount(0);
  await page.goto(`/scan/${f.slug}`);
  await expect(page.getByRole('main')).toBeVisible();
  await expect(planet).toHaveCount(0);
});

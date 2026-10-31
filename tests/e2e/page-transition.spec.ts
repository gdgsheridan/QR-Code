import { expect, test, type Page } from '@playwright/test';
import { signIn } from '../fixtures/e2e';
import { generateToken, sha256hex } from '@/lib/domain/token';
import { createAccount, createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC §15 Look (v0.11.29): page transitions, a staggered rise. Templates remount per navigation; layouts (the admin
// header) persist.
test.describe.configure({ mode: 'serial' });
let f: StandardFixture;
test.beforeAll(async () => { f = await createStandardFixture(); });
test.afterAll(async () => { await f?.close(); });

const emailOf = async (id: string) => (await f.pool.query<{ email: string }>('select email from participants where id = $1', [id])).rows[0]?.email ?? '';
// The innermost template wrapper (the page that just arrived): its class, its sections' animations, and, once the
// rise has finished, each section's opacity and transform.
const innermost = (page: Page) => page.evaluate(() => {
  const wrappers = document.querySelectorAll<HTMLElement>('[data-page]');
  const page = wrappers[wrappers.length - 1];
  const sections = page ? Array.from(page.children).flatMap((child) => Array.from(child.children)) : [];
  return {
    rise: page?.classList.contains('page-rise') ?? false,
    sections: sections.length,
    animations: sections.reduce((n, el) => n + el.getAnimations().length, 0),
    settled: sections.every((el) => getComputedStyle(el).opacity === '1' && getComputedStyle(el).transform === 'none'),
  };
});

test('T-UI-02: a fresh load rises with CSS; a client navigation rises section by section with Framer Motion; both settle', async ({ page }) => {
  await createAccount(await emailOf(f.p.A));
  await signIn(page, await emailOf(f.p.A), '/me');
  await page.reload(); // a fresh document load (signing in arrives by client navigation)
  expect(await innermost(page)).toMatchObject({ rise: true }); // the first load's CSS path (works without JS)
  await page.getByRole('link', { name: /^Schedule/ }).click();
  await page.waitForURL('**/me/schedule');
  const arriving = await innermost(page);
  expect(arriving.rise).toBe(false); // a client navigation: Framer Motion, not the CSS class
  expect(arriving.sections).toBeGreaterThan(1);
  await page.waitForTimeout(800);
  expect(await innermost(page)).toMatchObject({ settled: true, animations: 0 });
});

test('T-UI-02: switching admin tabs moves only the content: the header is the same element', async ({ page }) => {
  await signIn(page, f.staffEmail.org1, `/admin/${f.slug}`);
  await page.locator('header').evaluate((el) => { el.dataset.probe = 'kept'; });
  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Participants', exact: true }).click();
  await page.waitForURL(`**/admin/${f.slug}/participants`);
  await expect(page.locator('header[data-probe="kept"]')).toHaveCount(1);
  await page.waitForTimeout(800);
  expect(await innermost(page)).toMatchObject({ settled: true, animations: 0 });
});

test('T-UI-02: with reduced motion nothing rises', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page, f.staffEmail.org1, `/admin/${f.slug}`);
  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Checkpoints', exact: true }).click();
  await page.waitForURL(`**/admin/${f.slug}/checkpoints`);
  expect(await innermost(page)).toMatchObject({ rise: false, animations: 0, settled: true });
});


test('T-UI-02: RSVP steps rise in like pages and settle; reduced motion stays still', async ({ page }) => {
  const token = generateToken();
  await f.pool.query(
    `insert into participants (event_id, email, first_name, search_text, status, source, rsvp_token_hash, rsvp_sent_at)
     values ($1, $2, 'Rise', 'rise', 'pending', 'sheet', $3, now())`,
    [f.e1.id, `rise-${f.slug}@example.test`, sha256hex(token)],
  );
  const snapshot = () => page.locator('[data-rsvp-step="yes_form"]').evaluate((step) => {
    const blocks = Array.from(step.children).flatMap((child) =>
      child.matches('form, div') ? Array.from(child.children) : [child]);
    return {
      blocks: blocks.length,
      // Focus colours are CSS transitions; the rise is not one.
      animations: blocks.reduce((n, el) => n + el.getAnimations().filter((a) => !(a instanceof CSSTransition)).length, 0),
      moving: blocks.some((el) => getComputedStyle(el).opacity !== '1' || getComputedStyle(el).transform !== 'none'),
      settled: blocks.every((el) => getComputedStyle(el).opacity === '1' && getComputedStyle(el).transform === 'none'),
    };
  });

  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion });
    await page.goto('about:blank'); // a fresh load: the same /rsvp#token would only be a same-page jump
    await page.goto(`/rsvp#${token}`);
    await page.getByRole('button', { name: 'Yes, I’m coming', exact: true }).click();
    const arriving = await snapshot();
    expect(arriving.blocks).toBeGreaterThan(3);
    if (reducedMotion === 'reduce') {
      expect(arriving).toMatchObject({ animations: 0, moving: false, settled: true });
    } else {
      expect(arriving.animations).toBeGreaterThan(0);
      expect(arriving.moving).toBe(true);
    }
    await page.waitForTimeout(800);
    expect(await snapshot()).toMatchObject({ animations: 0, moving: false, settled: true });
    await page.getByLabel('Set a password for your Datathon account').fill('typing-does-not-replay');
    expect(await snapshot()).toMatchObject({ animations: 0, settled: true });
  }
});

test('T-UI-02: the profile setup step bar fills as you go forward and back; reduced motion stays still', async ({ page }) => {
  const email = await emailOf(f.p.B);
  await createAccount(email);
  await signIn(page, email, '/me/profile?setup=1');
  const fills = page.locator('[data-setup-fill]');
  const secondFill = fills.nth(1);
  const snapshot = () => fills.evaluateAll((elements) => elements.map((el) => ({
    filled: el.getAttribute('data-filled') === 'true',
    running: el.getAnimations().filter((animation) => animation.playState === 'running').length,
    transform: getComputedStyle(el).transform,
  })));
  const settle = () => fills.evaluateAll(async (elements) => {
    await Promise.all(elements.flatMap((el) => el.getAnimations().map((animation) => animation.finished)));
  });

  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion });
    await page.goto('/me/profile?setup=1');
    await expect(page.getByText('Step 1 of 4: The event', { exact: true })).toBeVisible();
    await expect(fills).toHaveCount(4);
    await settle();
    await page.getByRole('radio', { name: 'Not sure yet', exact: true }).check();
    await page.getByRole('radio', { name: 'I plan to go solo', exact: true }).check();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText('Step 2 of 4: Health and access', { exact: true })).toBeVisible();
    const arriving = await snapshot();
    expect(arriving[1]?.filled).toBe(true);
    expect(arriving[0]?.running).toBe(0); // Already-filled segments stay still.
    if (reducedMotion === 'reduce') {
      expect(arriving.every((fill) => fill.running === 0)).toBe(true);
    } else {
      expect(arriving[1]?.running).toBeGreaterThan(0);
    }
    await settle();
    await expect(secondFill).toHaveCSS('transform', /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);

    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByText('Step 1 of 4: The event', { exact: true })).toBeVisible();
    const returning = await snapshot();
    expect(returning[1]?.filled).toBe(false);
    expect(returning[0]?.running).toBe(0);
    if (reducedMotion === 'reduce') {
      expect(returning.every((fill) => fill.running === 0)).toBe(true);
    } else {
      expect(returning[1]?.running).toBeGreaterThan(0);
    }
    await settle();
    await expect(secondFill).toHaveCSS('transform', 'matrix(0, 0, 0, 1, 0, 0)');
  }
});

test('T-UI-03: Atom floats beside attendee content only when there is room, and stays off pass and staff pages', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const email = await emailOf(f.p.N);
  await createAccount(email);
  await signIn(page, email, '/me');
  const atom = page.locator('img[data-atom]');
  await expect(atom).toBeVisible();
  await expect(atom).toHaveAttribute('alt', '');
  await expect(atom).toHaveAttribute('aria-hidden', 'true');
  await expect(atom).toHaveCSS('pointer-events', 'none');
  await expect.poll(() => atom.evaluate((img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth === 640)).toBe(true);

  const besideContent = async () => {
    const image = await atom.boundingBox();
    const main = await page.getByRole('main').boundingBox();
    if (!image || !main) throw new Error('Atom and the main column must have bounding boxes');
    expect(image.x).toBeGreaterThan(main.x + main.width);
  };
  await besideContent();
  // Include the tightest gutter, and both wider attendee columns at their own thresholds.
  for (const [route, width] of [['/me', 1200], ['/me/schedule', 1840], ['/me/hackers', 2040]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(route);
    await expect(atom).toBeVisible();
    await besideContent();
    await page.setViewportSize({ width: width - 1, height: 900 });
    await expect(atom).toBeHidden();
  }

  await page.goto('/me');
  for (const viewport of [{ width: 1024, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect(atom).toBeHidden();
    await expect(atom).toHaveCSS('display', 'none');
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(atom).toBeVisible();
  await expect(atom).toHaveCSS('animation-name', 'none');
  await page.goto('/p');
  await expect(page.getByRole('main')).toBeVisible();
  await expect(atom).toHaveCount(0);
  await signIn(page, f.staffEmail.org1, `/admin/${f.slug}`);
  await expect(page.getByRole('navigation', { name: 'Admin' })).toBeVisible();
  await expect(atom).toHaveCount(0);
});

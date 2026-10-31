import { test, expect } from '@playwright/test';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';
import { authStatePath, saveSignedInState } from '../fixtures/e2e';

// One worker for the file: each worker's beforeAll would overwrite the shared sign-in state.
test.describe.configure({ mode: 'serial' });
const ORG = authStatePath('admin-header-org');
test.use({ storageState: ORG });
let f: StandardFixture;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  f = await createStandardFixture();
  await saveSignedInState(browser, f.staffEmail.org1, ORG);
});
test.afterAll(async () => { await f?.close(); });

for (const [width, height] of [[390, 844], [1440, 900], [1920, 1080]] as const) {
  test(`T-ADM-01: admin header stays in one row at ${width}px with reachable tabs`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(`/admin/${f.slug}`);
    await expect(page.getByTestId('kpi-accepted')).toBeVisible();
    const header = page.locator('header');
    const nav = page.getByRole('navigation', { name: 'Admin' });
    const links = nav.getByRole('link');
    await expect(links).toHaveCount(9); // v0.11.22: Tools is back in the header (§11).
    await expect(links.first()).toHaveAttribute('aria-current', 'page');
    await expect(header.getByText(f.e1.name, { exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    const geometry = await header.evaluate(el => {
      const nav = el.querySelector('nav')!;
      const mark = el.querySelector('img')!;
      const name = mark.nextElementSibling!;
      const active = nav.querySelector('[aria-current="page"]')!;
      return {
        height: el.getBoundingClientRect().height,
        centerOffset: Math.abs((mark.getBoundingClientRect().top + mark.getBoundingClientRect().bottom) / 2 - (nav.getBoundingClientRect().top + nav.getBoundingClientRect().bottom) / 2),
        underlineGap: el.getBoundingClientRect().bottom - active.getBoundingClientRect().bottom,
        pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
        navWidth: nav.clientWidth,
        navScrollWidth: nav.scrollWidth,
        nameTruncated: name.scrollWidth > name.clientWidth,
        nameOverflow: getComputedStyle(name).textOverflow,
      };
    });
    expect(geometry.height).toBeLessThanOrEqual(56);
    expect(geometry.centerOffset).toBeLessThanOrEqual(1);
    expect(geometry.underlineGap).toBe(1);
    expect(geometry.pageOverflow).toBe(0);
    if (width === 390) {
      expect(geometry.navScrollWidth).toBeGreaterThan(geometry.navWidth);
      expect(geometry.nameTruncated).toBe(true);
      expect(geometry.nameOverflow).toBe('ellipsis');
    } else {
      expect(geometry.navScrollWidth).toBeLessThanOrEqual(geometry.navWidth);
    }
    if (process.env.ADMIN_HEADER_SCREENSHOTS) {
      await page.screenshot({ path: `${process.env.ADMIN_HEADER_SCREENSHOTS}/admin-header-${width}.png` });
    }

    await links.first().focus();
    for (let i = 0; i < 9; i++) {
      const link = links.nth(i);
      await expect(link).toBeFocused();
      const box = await link.boundingBox();
      const navBox = await nav.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(navBox!.x - 1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(navBox!.x + navBox!.width + 1);
      expect(await link.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
      if (i < 8) await page.keyboard.press('Tab');
    }
    await nav.evaluate(el => { el.scrollLeft = 0; });
    await expect.poll(() => nav.evaluate(el => el.scrollLeft)).toBe(0);
    await nav.evaluate(el => { el.scrollLeft = el.scrollWidth; });
    if (width === 390) expect(await nav.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    await page.evaluate(() => window.scrollTo(0, 300));
    expect((await header.boundingBox())!.y).toBe(0);
  });
}

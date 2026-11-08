import { expect, test } from '@playwright/test';
import { authStatePath, E2E_ORIGIN, installFakeNfc, nfcActive, nfcTap, nfcWrites, saveSignedInState, serialOf } from '../fixtures/e2e';
import { createStandardFixture, randomUid, type StandardFixture } from '../fixtures/standard';

// SPEC §11 Judges (v0.12.4, owner's request). The e2e server runs with BADGE_ORIGIN=https://badges.example.test.
const ORG = authStatePath('judges-org');
test.describe.configure({ mode: 'serial' });
test.use({ storageState: ORG });

let f: StandardFixture;
test.beforeAll(async ({ browser }) => {
  f = await createStandardFixture();
  await saveSignedInState(browser, f.staffEmail.org1, ORG);
});
test.afterAll(async () => {
  await f.close();
});

test('T-JUDGE-04: the judges listed, fix a LinkedIn, link a judge’s badge; tapping it shows Judge, title and LinkedIn', async ({ page, browser }) => {
  await installFakeNfc(page);
  await page.goto(`/admin/${f.slug}`);
  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Judges', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Judges', level: 1 })).toBeVisible();
  await expect(page.getByText('No judges yet.')).toBeVisible();

  // v0.12.4: no Import CSV on the page (owner's request); judges are loaded behind the scenes.
  await expect(page.getByRole('heading', { name: 'Import CSV' })).toHaveCount(0);
  await f.pool.query(
    `insert into judges (event_id, name, title, linkedin_url) values ($1, 'Ayush Singh', 'Research Scientist @ Meta', null), ($1, 'Mahir Azim', 'AI Product Manager @ EY', 'https://www.linkedin.com/in/mahirazim')`,
    [f.e1.id],
  );
  await page.reload();
  const ayush = page.getByRole('listitem', { name: 'Ayush Singh' });
  await expect(ayush).toContainText('Research Scientist @ Meta');
  // Every judge has a Profile button, badge or not: their own page shows the badge's card.
  const profile = ayush.getByRole('link', { name: 'Open Ayush Singh’s profile' });
  await expect(profile).toHaveAttribute('target', '_blank');
  const judgeHref = await profile.getAttribute('href');
  expect(judgeHref).toMatch(/^\/judge\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('listitem', { name: 'Mahir Azim' }).getByLabel('LinkedIn for Mahir Azim')).toHaveValue('https://www.linkedin.com/in/mahirazim');

  const linkedin = ayush.getByLabel('LinkedIn for Ayush Singh');
  await linkedin.fill('linkedin.com/company/meta');
  await ayush.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'That isn’t a LinkedIn profile link' })).toBeVisible();
  await linkedin.fill('linkedin.com/in/ayush-singh-se/');
  await ayush.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: '✓ LinkedIn saved for Ayush Singh.' })).toBeVisible();
  await expect(linkedin).toHaveValue('https://www.linkedin.com/in/ayush-singh-se');

  await ayush.getByRole('button', { name: 'Link badge for Ayush Singh' }).click();
  const dialog = page.getByRole('dialog', { name: 'Link a badge' });
  await expect(dialog).toContainText('Tap the badge to link it to Ayush Singh.');
  await expect.poll(() => nfcActive(page)).toBe(1);
  const uid = randomUid();
  await nfcTap(page, serialOf(uid));
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: `✓ Badge ${serialOf(uid)} linked to Ayush Singh. Its profile link is on the badge.` })).toBeVisible();
  await expect(ayush).toContainText('✓ Badge linked');
  expect(await nfcWrites(page)).toEqual([{ records: [{ recordType: 'url', data: `https://badges.example.test/profile/${uid}?tap` }] }]);
  expect(await nfcActive(page)).toBe(0);

  const { uid: hackerUid } = await f.linkBadge(f.p.A);
  await page.getByRole('listitem', { name: 'Mahir Azim' }).getByRole('button', { name: 'Link badge for Mahir Azim' }).click();
  await expect.poll(() => nfcActive(page)).toBe(1);
  await nfcTap(page, serialOf(hackerUid), [`https://badges.example.test/profile/${hackerUid}?tap`]);
  // v0.12.4 (owner's request): the tap overwrites: the hacker's badge moves to the judge.
  await expect(page.getByRole('status').filter({ hasText: `✓ Badge ${serialOf(hackerUid)} linked to Mahir Azim. It was Ada Fixture’s badge, so it’s unlinked from them.` })).toBeVisible();
  await expect(page.getByRole('listitem', { name: 'Mahir Azim' })).toContainText('✓ Badge linked');

  // Anyone tapping the judge's badge: Judge, name, title, LinkedIn; no Connect, no email.
  const anon = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: undefined });
  const tap = await anon.newPage();
  await tap.goto(`/profile/${uid}?tap`);
  await expect(tap.getByRole('heading', { name: 'Ayush Singh' })).toBeVisible();
  await expect(tap.getByText('Judge', { exact: true })).toBeVisible();
  await expect(tap.getByText('Research Scientist @ Meta')).toBeVisible();
  await expect(tap.getByRole('link', { name: /LinkedIn/ })).toHaveAttribute('href', 'https://www.linkedin.com/in/ayush-singh-se');
  await expect(tap.getByRole('button', { name: /Connect/ })).toHaveCount(0);
  await tap.goto(judgeHref!); // their own page: the same card
  await expect(tap.getByRole('heading', { name: 'Ayush Singh' })).toBeVisible();
  await expect(tap.getByText('Judge', { exact: true })).toBeVisible();
  await expect(tap.getByRole('link', { name: /LinkedIn/ })).toHaveAttribute('href', 'https://www.linkedin.com/in/ayush-singh-se');
  expect((await tap.goto('/judge/00000000-0000-4000-8000-000000000000'))?.status()).toBe(404);
  await anon.close();

  // Unlink: the badge stops opening the judge.
  await ayush.getByRole('button', { name: 'Unlink badge for Ayush Singh' }).click();
  await page.getByRole('dialog', { name: 'Unlink this badge?' }).getByRole('button', { name: 'Unlink badge' }).click();
  await expect(ayush).toContainText('No badge');
});

import { expect, test } from '@playwright/test';
import { authStatePath, installFakeNfc, nfcActive, nfcTap, nfcUnreadable, nfcWrites, saveSignedInState, serialOf } from '../fixtures/e2e';
import { createStandardFixture, randomUid, type StandardFixture } from '../fixtures/standard';

// SPEC §11 Participants badge linking and writing / §14.15. The e2e server runs with
// BADGE_ORIGIN=https://badges.example.test.
const ORG = authStatePath('badge-writer-org');
const ORIGIN = 'https://badges.example.test';
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

test('T-NFC-28: Tools no longer writes or links badges and without Web NFC participant linking is hidden', async ({ page }) => {
  await page.goto(`/admin/${f.slug}`);
  await expect(page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Participants' })).toBeVisible();
  // v0.11.22: Tools is back, for Import CSV (F10); v0.12.4: and the CSV downloads.
  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Tools', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Import CSV' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Link a badge' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /writing/i })).toHaveCount(0);
  await page.goto(`/admin/${f.slug}/participants`);
  await expect(page.getByRole('row', { name: /Ada Fixture/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Link|Replace) badge for / })).toHaveCount(0);
});

test('T-NFC-28: Participants links an accepted attendee’s badge, stops reading and can unlink it', async ({ page }) => {
  await installFakeNfc(page);
  await page.goto(`/admin/${f.slug}/participants`);
  const ada = page.getByRole('row', { name: /Ada Fixture/ });
  const cy = page.getByRole('row', { name: /Cy Fixture/ });
  await expect(cy).toContainText('waitlisted');
  await expect(cy.getByRole('button', { name: /^(Link|Replace) badge for / })).toHaveCount(0);
  expect(await nfcActive(page)).toBe(0);
  await ada.getByRole('button', { name: 'Link badge for Ada Fixture', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Link a badge', exact: true });
  await expect(dialog).toContainText('Tap the badge to link it to Ada Fixture.');
  expect(await nfcActive(page)).toBe(1);
  await nfcUnreadable(page);
  await expect(dialog).toContainText('Couldn’t read that badge. Hold it still and tap again.');
  await nfcTap(page, 'not-a-uid');
  await expect(dialog).toBeVisible();
  expect(await nfcActive(page)).toBe(1);
  const status = page.getByRole('status');

  const uid = randomUid();
  await nfcTap(page, serialOf(uid));
  await expect(dialog).toHaveCount(0);
  await expect(status).toHaveCount(1);
  await expect(status).toHaveText(`✓ Badge ${serialOf(uid)} linked to Ada Fixture. Its profile link is on the badge.`);
  await expect(ada.getByText('Badge linked', { exact: true })).toBeVisible();
  await expect(ada.getByRole('button', { name: 'Replace badge for Ada Fixture', exact: true })).toBeVisible();
  expect(await nfcActive(page)).toBe(0);
  const ignoredUid = randomUid();
  await nfcTap(page, serialOf(ignoredUid)); // the reader stopped: a second tap links nothing
  await expect(status).toHaveText(`✓ Badge ${serialOf(uid)} linked to Ada Fixture. Its profile link is on the badge.`);
  expect((await f.pool.query('select participant_id from badges where uid = $1', [uid])).rows).toEqual([{ participant_id: f.p.A }]);
  expect((await f.pool.query('select participant_id from badges where uid = $1', [ignoredUid])).rows).toEqual([]);
  expect(await nfcWrites(page)).toEqual([{ records: [{ recordType: 'url', data: `${ORIGIN}/profile/${uid}?tap` }] }]);
  expect((await f.badgeScan({ cp: f.cp.R, staff: f.staff.vol1, uid })).code).toBe('ACCEPTED');

  await ada.getByRole('button', { name: 'Unlink badge for Ada Fixture', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Unlink this badge?', exact: true });
  await expect(confirm).toContainText('Ada Fixture’s badge stops working (scans and profile) until staff link it again. The chip itself doesn’t change.');
  await confirm.getByRole('button', { name: 'Unlink badge', exact: true }).click();
  await expect(status).toHaveText('✓ Badge unlinked. It stops working until it’s linked again.');
  await expect(ada.getByText('Badge linked', { exact: true })).toHaveCount(0);
  await expect(ada.getByRole('button', { name: 'Unlink badge for Ada Fixture', exact: true })).toHaveCount(0);
  await expect(ada.getByRole('button', { name: 'Link badge for Ada Fixture', exact: true })).toBeVisible();
  expect((await f.pool.query('select participant_id from badges where uid = $1', [uid])).rows).toEqual([]);
  expect((await f.badgeScan({ cp: f.cp.R, staff: f.staff.vol1, uid })).code).toBe('NOT_FOUND');
});

test('T-NFC-28: unlinking a badge that is already gone says so instead of asking to try again', async ({ page }) => {
  const { id } = await f.addParticipant(f.e1.id);
  await f.linkBadge(id);
  await page.goto(`/admin/${f.slug}/participants`);
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Unlink badge for Extra Fixture' }) });
  await expect(row).toContainText('Badge linked');
  await f.pool.query('delete from badges where participant_id = $1', [id]); // e.g. another organizer moved it meanwhile
  await row.getByRole('button', { name: 'Unlink badge for Extra Fixture' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Unlink badge' }).click();
  await expect(page.getByRole('status')).toHaveText('! That badge was already unlinked.');
  await expect(page.getByRole('button', { name: 'Unlink badge for Extra Fixture' })).toHaveCount(0);
});

test('T-NFC-28: after Chrome refuses NFC, the link dialog can start the reader again', async ({ page }) => {
  await installFakeNfc(page);
  await page.addInitScript(() => {
    // The first scan() is refused, as when the NFC permission is denied; the organizer then allows it.
    const reader = (window as unknown as { NDEFReader: { prototype: { scan: (o?: unknown) => Promise<void> } } }).NDEFReader;
    const scan = reader.prototype.scan;
    let refuse = true;
    reader.prototype.scan = function (this: unknown, o?: unknown) {
      if (refuse) {
        refuse = false;
        return Promise.reject(new DOMException('denied', 'NotAllowedError'));
      }
      return scan.call(this, o);
    };
  });
  await page.goto(`/admin/${f.slug}/participants`);
  await page.getByRole('button', { name: /^(Link|Replace) badge for Ben Fixture$/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Link a badge' });
  await expect(dialog).toContainText('NFC permission was denied');
  expect(await nfcActive(page)).toBe(0);
  await dialog.getByRole('button', { name: 'Start badge reader' }).click();
  await expect.poll(() => nfcActive(page)).toBe(1);
  const uid = randomUid();
  await nfcTap(page, serialOf(uid));
  await expect(page.getByRole('status')).toHaveText(`✓ Badge ${serialOf(uid)} linked to Ben Fixture. Its profile link is on the badge.`);
});

test('T-NFC-28: a badge the server refuses shows a red notice, never a green screen', async ({ page }) => {
  await installFakeNfc(page);
  await page.route('**/api/events/*/badges', (route) => route.fulfill({ json: { code: 'BADGE_TAKEN' } }));
  await page.goto(`/admin/${f.slug}/participants`);
  await page.getByRole('button', { name: 'Link badge for Ada Fixture', exact: true }).click();
  const uid = randomUid();
  await nfcTap(page, serialOf(uid));
  const status = page.getByRole('status');
  await expect(status).toHaveCount(1);
  await expect(status).toHaveText(`✕ Badge ${serialOf(uid)} is linked to someone else. Ask an organizer to move it.`);
  await expect(status).toHaveAttribute('data-tone', 'bad');
  await expect(page.getByTestId('scan-result')).toHaveCount(0);
  expect(await nfcActive(page)).toBe(0);
});

test('T-NFC-28: Cancel and Escape stop waiting for a badge without linking one', async ({ page }) => {
  await installFakeNfc(page);
  await page.goto(`/admin/${f.slug}/participants`);
  const link = page.getByRole('button', { name: 'Link badge for Ada Fixture', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Link a badge', exact: true });
  for (const cancel of ['button', 'escape']) {
    await link.click();
    await expect(dialog).toBeVisible();
    expect(await nfcActive(page)).toBe(1);
    if (cancel === 'button') await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    else await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(await nfcActive(page)).toBe(0);
    const uid = randomUid();
    await nfcTap(page, serialOf(uid));
    expect((await f.pool.query('select participant_id from badges where uid = $1', [uid])).rows).toEqual([]);
  }
});

for (const mode of ['existing', 'failed', 'timeout', 'different', 'close', 'multiple'] as const) {
  test(`T-NFC-28: linking handles a ${mode} profile write`, async ({ page }) => {
    await installFakeNfc(page);
    if (['failed', 'timeout', 'different', 'close'].includes(mode)) await page.addInitScript((mode) => {
      const w = window as unknown as { NDEFReader: { prototype: { write: (message: unknown, options: { signal: AbortSignal }) => Promise<void> } }; __writeAborted: boolean };
      w.NDEFReader.prototype.write = async (_, { signal }) => {
        if (mode === 'failed') throw new Error('read only');
        return new Promise((_, reject) => signal.addEventListener('abort', () => {
          w.__writeAborted = true;
          reject(new DOMException('cancelled', 'AbortError'));
        }));
      };
    }, mode);
    await page.goto(`/admin/${f.slug}/participants`);
    await page.getByRole('button', { name: /^(Link|Replace) badge for Ada Fixture$/ }).click();
    const uid = randomUid();
    const url = `${ORIGIN}/profile/${uid}?tap`;
    await nfcTap(page, serialOf(uid), mode === 'existing' ? [url] : mode === 'multiple' ? [url, url] : []);
    if (mode === 'different') await nfcTap(page, serialOf(randomUid()));
    if (mode === 'close') await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    const suffix = mode === 'existing' ? '' : mode === 'multiple' ? ' Its profile link is on the badge.' : " Couldn't write its profile link: hold the badge still and tap Link badge again.";
    await expect(page.getByRole('status')).toHaveText(`✓ Badge ${serialOf(uid)} linked to Ada Fixture.${suffix}`, { timeout: 10000 });
    if (['timeout', 'different', 'close'].includes(mode)) expect(await page.evaluate(() => (window as unknown as { __writeAborted: boolean }).__writeAborted)).toBe(true);
    expect(await nfcWrites(page)).toEqual(mode === 'multiple' ? [{ records: [{ recordType: 'url', data: url }] }] : []);
    expect((await f.pool.query('select participant_id from badges where uid = $1', [uid])).rows).toEqual([{ participant_id: f.p.A }]);
    await expect(page.getByTestId('scan-result')).toHaveCount(0);
  });
}

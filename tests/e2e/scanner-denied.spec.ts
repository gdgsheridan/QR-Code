import { expect, test } from '@playwright/test';
import { authStatePath, chooseCheckpoint, fakeCameraArgs, installFakeNfc, saveSignedInState, warmDevServer } from '../fixtures/e2e';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

const AUTH = authStatePath('scanner-denied');
test.use({ launchOptions: { args: fakeCameraArgs() }, storageState: AUTH });

let f: StandardFixture;
test.beforeAll(async ({ browser }) => {
  f = await createStandardFixture();
  await saveSignedInState(browser, f.staffEmail.vol1, AUTH);
  await warmDevServer(f.slug);
});
test.afterAll(async () => {
  await f.close();
});

test('T-SCUI-08: camera permission denied shows instructions and manual search still records a real scan', async ({ page }) => {
  // The camera is the one browser surface tests may fake (CLAUDE.md): the user said "Block".
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
  await installFakeNfc(page); // v0.12.1: Check-in runs only on phones with Web NFC
  await page.goto(`/scan/${f.slug}`);
  await chooseCheckpoint(page, 'Door');
  await expect(page.getByText(/Camera access is blocked/)).toBeVisible();
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'denied');

  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('ada');
  await page.getByRole('button', { name: 'Record scan for Ada Fixture' }).click();
  const result = page.getByTestId('scan-result');
  await expect(result).toHaveAttribute('data-tone', 'green');
  await expect(result).toContainText('ADMIT');
  const { rows } = await f.pool.query('select method from scans where participant_id = $1 and checkpoint_id = $2', [f.p.A, f.cp.D]);
  expect(rows).toEqual([{ method: 'manual' }]);
});

import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { generateQrVideo } from '../../scripts/gen-qr-video';
import { authStatePath, chooseCheckpoint, E2E_ORIGIN, fakeCameraArgs, installFakeNfc, saveSignedInState } from '../fixtures/e2e';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

const VIDEO = join(process.cwd(), 'tests', 'assets', 'e2e-malformed.y4m');
const AUTH = authStatePath('scanner-malformed');

test.describe.configure({ mode: 'serial' });
test.use({ launchOptions: { args: fakeCameraArgs(VIDEO) }, permissions: ['camera'], storageState: AUTH });

let f: StandardFixture;
test.beforeAll(async ({ browser }) => {
  f = await createStandardFixture();
  await generateQrVideo('https://example.com', VIDEO, E2E_ORIGIN);
  await saveSignedInState(browser, f.staffEmail.vol1, AUTH);
});
test.afterAll(async () => {
  await f.close();
});

test('T-SCUI-06: a QR encoding https://example.com shows "Not a Datathon code" and makes zero /api/scan requests', async ({ page }) => {
  let scans = 0;
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/api/scan') scans += 1;
  });
  await installFakeNfc(page); // v0.12.1: Check-in runs only on phones with Web NFC
  await page.goto(`/scan/${f.slug}`);
  await chooseCheckpoint(page, 'Door');
  const result = page.getByTestId('scan-result');
  await expect(result).toContainText('Not a Datathon code');
  await expect(result).toHaveAttribute('data-tone', 'amber');
  await expect(result).toHaveAttribute('data-dismiss', 'auto');
  await expect(result).toBeHidden({ timeout: 3000 });
  await page.waitForTimeout(3000);
  expect(scans).toBe(0);
});

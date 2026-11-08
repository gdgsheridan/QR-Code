import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { generateQrVideo } from '../../scripts/gen-qr-video';
import { authStatePath, chooseCheckpoint, E2E_ORIGIN, fakeCameraArgs, installFakeNfc, saveSignedInState, warmDevServer } from '../fixtures/e2e';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// Chromium plays this file as the camera: fixture participant A's real pass QR.
const VIDEO = join(process.cwd(), 'tests', 'assets', 'e2e-camera.y4m');
const AUTH = authStatePath('scanner-camera');

test.describe.configure({ mode: 'serial' });
test.use({ launchOptions: { args: fakeCameraArgs(VIDEO) }, permissions: ['camera'], storageState: AUTH });

let f: StandardFixture;
test.beforeAll(async ({ browser }) => {
  f = await createStandardFixture();
  await generateQrVideo(f.token.A, VIDEO, E2E_ORIGIN);
  await saveSignedInState(browser, f.staffEmail.vol1, AUTH);
  await warmDevServer(f.slug);
});
test.afterAll(async () => {
  await f.close();
});

test('T-SCUI-01: A\'s QR in front of the camera shows ADMIT within 1.5 s of the scanner being ready; T-SCUI-11: <video playsinline muted>', async ({ page }) => {
  await installFakeNfc(page); // v0.12.1: Check-in runs only on phones with Web NFC
  await page.goto(`/scan/${f.slug}`);
  await chooseCheckpoint(page, 'Door');
  const result = page.getByTestId('scan-result');
  await expect(result).toHaveAttribute('data-tone', 'green');
  await expect(result).toContainText('ADMIT');
  await expect(result).toContainText('Ada Fixture');

  const activeAt = Number(await page.locator('main').getAttribute('data-active-at'));
  const shownAt = Number(await result.getAttribute('data-shown-at'));
  expect(shownAt - activeAt).toBeLessThan(1500);

  const video = page.locator('video');
  await expect(video).toHaveAttribute('playsinline', '');
  await expect(video).toHaveAttribute('muted', '');
  expect(await video.evaluate((v: HTMLVideoElement) => v.muted && v.playsInline)).toBe(true);

  const { rows } = await f.pool.query('select method from scans where participant_id = $1 and checkpoint_id = $2 and voided_at is null', [
    f.p.A,
    f.cp.D,
  ]);
  expect(rows).toEqual([{ method: 'qr' }]);
});

test('T-SCUI-02: the same QR kept in frame for 10 s causes exactly one /api/scan request', async ({ page }) => {
  const scans: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/api/scan') scans.push(r.postData() ?? '');
  });
  await page.goto(`/scan/${f.slug}`);
  await chooseCheckpoint(page, 'Raffle'); // fresh context: no saved checkpoint, so the picker opens
  await expect(page.getByTestId('scan-result')).toContainText('RECORDED');
  await page.waitForTimeout(10_000);
  expect(scans).toHaveLength(1);
  // I-3: the token only ever travels in the POST body.
  expect(page.url()).not.toContain(f.token.A);
});

test('§17 A7: without a native BarcodeDetector (as on iOS Safari) the self-hosted zxing WebAssembly decodes the pass', async ({ page }) => {
  // Its own checkpoint, so this test doesn't depend on the others having run.
  await f.pool.query(
    `insert into checkpoints (event_id, name, kind, requires_checkin, is_open, sort_order) values ($1, 'Booth', 'custom', false, true, 9)`,
    [f.e1.id],
  );
  await page.addInitScript(() => {
    delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
  });
  const wasm: string[] = [];
  page.on('response', (r) => {
    if (r.url().includes('.wasm')) wasm.push(`${r.url()} ${r.status()}`);
  });
  await page.goto(`/scan/${f.slug}`);
  await chooseCheckpoint(page, 'Booth');
  await expect(page.getByTestId('scan-result')).toContainText('RECORDED', { timeout: 10_000 });
  // Self-hosted (no CDN) and fetched once, even though dev mode mounts the scanner twice.
  expect(wasm).toEqual([`${E2E_ORIGIN}/zxing/zxing_reader.wasm 200`]);
});

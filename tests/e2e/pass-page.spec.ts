import jsQR from 'jsqr';
import sharp from 'sharp';
import { expect, test } from '@playwright/test';
import { generateToken } from '@/lib/domain/token';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
test.beforeEach(async () => {
  f = await createStandardFixture();
});
test.afterEach(async () => {
  await f.close();
});

test('T-PASS-01: /p#token shows name, event and a QR of exactly APP_ORIGIN/p#token; the token only travels in a POST body', async ({
  page,
  baseURL,
}) => {
  const token = f.token.A;
  const seen: Array<{ url: string; method: string; body: string | null }> = [];
  page.on('request', (r) => seen.push({ url: r.url(), method: r.method(), body: r.postData() }));

  await page.goto(`/p#${token}`);
  await expect(page.getByRole('heading', { name: 'Ada Fixture', exact: true })).toBeVisible();
  await expect(page.getByText(f.e1.name)).toBeVisible();
  await expect(page.getByText('Fixture Hall')).toBeVisible();
  const qr = page.getByRole('img', { name: 'Your check-in QR code' });
  await expect(qr).toBeVisible();

  // Decode what the participant would show at the door (I-4).
  const png = Buffer.from((await qr.evaluate((c: HTMLCanvasElement) => c.toDataURL('image/png'))).split(',')[1] ?? '', 'base64');
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data).toBe(`${baseURL}/p#${token}`);

  // I-3: never in a URL; only in the POST /api/pass body.
  expect(seen.filter((r) => r.url.includes(token))).toEqual([]);
  const carriers = seen.filter((r) => r.body?.includes(token));
  expect(carriers.length).toBeGreaterThan(0);
  for (const r of carriers) expect({ method: r.method, path: new URL(r.url).pathname }).toEqual({ method: 'POST', path: '/api/pass' });
});

test('F5: on a phone-sized screen the pass fits without sideways scrolling', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 360, height: 740 } });
  await page.goto(`/p#${f.token.A}`);
  const qr = page.getByRole('img', { name: 'Your check-in QR code' });
  await expect(qr).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  const box = await qr.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(200);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
  await page.close();
});

test('T-PASS-03: replaced, cancelled and unknown passes show their messages', async ({ page }) => {
  await page.goto(`/p#${f.rvOldToken}`);
  await expect(page.getByRole('heading', { name: 'This pass was replaced' })).toBeVisible();
  await page.goto(`/p#${f.token.Wd}`);
  await expect(page.getByRole('heading', { name: 'This pass is no longer valid' })).toBeVisible();
  await page.goto(`/p#${generateToken()}`);
  await expect(page.getByRole('heading', { name: 'Pass not found' })).toBeVisible();
  await page.goto('/p');
  await expect(page.getByRole('heading', { name: 'Pass not found' })).toBeVisible();
});

import jsQR from 'jsqr';
import sharp from 'sharp';
import { expect, test, type Locator } from '@playwright/test';
import { generateToken } from '@/lib/domain/token';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;

async function decodeQr(qr: Locator): Promise<string | undefined> {
  const png = Buffer.from((await qr.evaluate((c: HTMLCanvasElement) => c.toDataURL('image/png'))).split(',')[1] ?? '', 'base64');
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data;
}

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

  // v0.11.25: the pass is about its holder: the QR first, then their team, track and shared links.
  const { rows: [track] } = await f.pool.query<{ id: string }>(`insert into tracks (event_id, name) values ($1, 'Best AI') returning id`, [f.e1.id]);
  const { rows: [team] } = await f.pool.query<{ id: string }>(
    `insert into teams (event_id, name, join_code, track_id) values ($1, 'Byte Club', 'ABCDEFGH', $2) returning id`, [f.e1.id, track?.id]);
  await f.pool.query(`update participants set team_id = $2, linkedin_url = 'https://www.linkedin.com/in/ada', discord_username = 'ada.codes' where id = $1`, [f.p.A, team?.id]);

  await page.goto(`/p#${token}`);
  await expect(page.getByRole('heading', { name: 'Ada Fixture' })).toBeVisible();
  await expect(page.getByText('Byte Club')).toBeVisible();
  await expect(page.getByText('Best AI')).toBeVisible();
  await expect(page.getByRole('link', { name: 'LinkedIn' })).toHaveAttribute('href', 'https://www.linkedin.com/in/ada');
  await expect(page.getByText('@ada.codes')).toBeVisible();
  await expect(page.getByText(f.e1.name)).toBeVisible();
  await expect(page.getByText('Fixture Hall')).toBeVisible();
  const qr = page.getByRole('img', { name: 'Your check-in QR code' });
  await expect(qr).toBeVisible();

  // Decode what the participant would show at the door (I-4).
  expect(await decodeQr(qr)).toBe(`${baseURL}/p#${token}`);

  // §15: links are 44 px tap targets.
  for (const link of await page.getByRole('list', { name: 'Your links' }).getByRole('link').all()) {
    expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  // I-3: never in a URL; only in the POST /api/pass body.
  expect(seen.filter((r) => r.url.includes(token))).toEqual([]);
  const carriers = seen.filter((r) => r.body?.includes(token));
  expect(carriers.length).toBeGreaterThan(0);
  for (const r of carriers) expect({ method: r.method, path: new URL(r.url).pathname }).toEqual({ method: 'POST', path: '/api/pass' });
});

test('T-PASS-01: the QR is drawn from the fragment before /api/pass answers, and stays when it fails', async ({ page, baseURL }) => {
  const token = f.token.A;
  // Held: no answer yet, the QR is already there.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/pass', async (route) => {
    await held;
    await route.abort('internetdisconnected');
  });
  await page.goto(`/p#${token}`);
  const qr = page.getByRole('img', { name: 'Your check-in QR code' });
  await expect(qr).toBeVisible();
  await expect(page.getByText('Checking your pass…')).toBeVisible();
  expect(await decodeQr(qr)).toBe(`${baseURL}/p#${token}`);

  // Failed at the network level: the QR stays, with a short note.
  release();
  await expect(page.getByText('Couldn’t check your pass right now. You can still show this code.')).toBeVisible();
  await expect(qr).toBeVisible();
  expect(await decodeQr(qr)).toBe(`${baseURL}/p#${token}`);
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();

  // A 5xx is the same; Retry reaches the server again and fills in the pass.
  await page.unroute('**/api/pass');
  await page.route('**/api/pass', (route) => route.fulfill({ status: 503, body: '{}' }));
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('Couldn’t check your pass right now. You can still show this code.')).toBeVisible();
  await expect(qr).toBeVisible();
  await page.unroute('**/api/pass');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: 'Ada Fixture' })).toBeVisible();
  await expect(page.getByText('Couldn’t check your pass right now. You can still show this code.')).toHaveCount(0);
  await expect(qr).toBeVisible();
});

test('T-PASS-01: a malformed fragment draws no QR', async ({ page }) => {
  await page.route('**/api/pass', () => new Promise(() => undefined)); // never answers
  await page.goto('/p#not-a-token');
  await expect(page.getByText('Loading your pass…')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Your check-in QR code' })).toHaveCount(0);
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
  // The QR drawn while checking goes away once the server says the pass is no good.
  const qr = page.getByRole('img', { name: 'Your check-in QR code' });
  await page.goto(`/p#${f.rvOldToken}`);
  await expect(page.getByRole('heading', { name: 'This pass was replaced' })).toBeVisible();
  await expect(qr).toHaveCount(0);
  await page.goto(`/p#${f.token.Wd}`);
  await expect(page.getByRole('heading', { name: 'This pass is no longer valid' })).toBeVisible();
  await expect(qr).toHaveCount(0);
  await page.goto(`/p#${generateToken()}`);
  await expect(page.getByRole('heading', { name: 'Pass not found' })).toBeVisible();
  await expect(qr).toHaveCount(0);
  await page.goto('/p');
  await expect(page.getByRole('heading', { name: 'Pass not found' })).toBeVisible();
});

import { expect, test } from '@playwright/test';
import { E2E_ORIGIN, signIn } from '../fixtures/e2e';
import { createAccount, createStandardFixture, randomUid, type StandardFixture } from '../fixtures/standard';

// SPEC §6.5 / §14.15: the public badge profile and the pass-page opt-in.
let f: StandardFixture;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  f = await createStandardFixture();
});
test.afterAll(async () => {
  await f.close();
});

const LINKEDIN = 'https://www.linkedin.com/in/ada-fixture';
const emailOf = async (participantId: string) =>
  (await f.pool.query<{ email: string }>('select email from participants where id = $1', [participantId])).rows[0]?.email ?? '';

test('T-NFC-14: anyone who taps a badge sees what its holder shares, signed in or not (v0.9)', async ({ browser, request }) => {
  const { uid } = await f.linkBadge(f.p.A);
  const tapPath = `/profile/${uid}?tap`;
  await f.pool.query('update participants set profile_public = true, linkedin_url = $2 where id = $1', [f.p.A, LINKEDIN]);

  // Signed out: no redirect to sign in, just the shared fields.
  const out = await request.get(tapPath, { maxRedirects: 0 });
  expect(out.status()).toBe(200);
  const html = await out.text();
  expect(html).toContain('Ada Fixture');
  expect(html).not.toContain(await emailOf(f.p.A));
  expect(html).not.toContain('Vegetarian');

  const anon = await browser.newContext({ baseURL: E2E_ORIGIN });
  const page = await anon.newPage();
  await page.goto(tapPath);
  await expect(page.getByRole('heading', { name: 'Ada Fixture' })).toBeVisible();
  await expect(page.getByRole('link', { name: /LinkedIn/ })).toHaveAttribute('href', LINKEDIN);

  // Opting out takes effect on the very next view (the page is never cached).
  await f.pool.query('update participants set profile_public = false where id = $1', [f.p.A]);
  await page.reload();
  await expect(page.getByRole('heading', { name: /hasn’t shared a profile/ })).toBeVisible();
  await expect(page.getByText('Ada')).toHaveCount(0);

  // Staff link unlinked badges at the check-in desk.
  await page.goto(`/profile/${randomUid()}?tap`);
  await expect(page.getByRole('heading', { name: 'This badge isn’t linked yet' })).toBeVisible();
  await expect(page.getByText('Staff link badges at the check-in desk.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in to link it' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /This is my badge/ })).toHaveCount(0);
  expect((await page.goto('/profile/not-a-uid'))?.status()).toBe(404);
  await anon.close();

  // X attends the other event: signed in, X sees the same as anyone.
  await f.pool.query('update participants set profile_public = true where id = $1', [f.p.A]);
  const x = await browser.newContext({ baseURL: E2E_ORIGIN });
  const xPage = await x.newPage();
  await createAccount(await emailOf(f.p.X));
  await signIn(xPage, await emailOf(f.p.X), tapPath);
  await expect(xPage.getByRole('heading', { name: 'Ada Fixture' })).toBeVisible();
  await x.close();
});

test('T-NFC-14: badge sharing is a one-line switch on the Hacker profile, not on the pass page (v0.11.25)', async ({ browser }) => {
  await f.pool.query('update participants set profile_public = false where id = $1', [f.p.B]); // on by default since v0.9
  const ctx = await browser.newContext({ baseURL: E2E_ORIGIN });
  const page = await ctx.newPage();
  await page.goto(`/p#${f.token.B}`);
  await expect(page.getByRole('img', { name: 'Your check-in QR code' })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await createAccount(await emailOf(f.p.B));
  await signIn(page, await emailOf(f.p.B), '/me/profile?tab=networking');
  const box = page.getByRole('checkbox', { name: 'Share my name and links on my badge' });
  await expect(box).not.toBeChecked();
  await box.check();
  await page.getByRole('button', { name: 'Save networking' }).click();
  await expect(page.getByText('✓ Saved.')).toBeVisible();
  const { rows } = await f.pool.query('select profile_public from participants where id = $1', [f.p.B]);
  expect(rows).toEqual([{ profile_public: true }]);
  await ctx.close();
});

test('T-NFC-21: staff link a badge; its holder sets their LinkedIn, Discord and website for others to see', async ({ browser }) => {
  const { uid } = await f.linkBadge(f.p.A);
  const tapPath = `/profile/${uid}?tap`;
  const a = await browser.newContext({ baseURL: E2E_ORIGIN });
  const page = await a.newPage();
  await createAccount(await emailOf(f.p.A));
  await signIn(page, await emailOf(f.p.A), '/me/profile');
  await page.getByRole('navigation', { name: 'Profile sections' }).getByRole('link', { name: 'Networking', exact: true }).click();
  await expect(page.getByText('✓ Badge linked.', { exact: true })).toBeVisible();

  // v0.9.2: the browser refuses a non-profile LinkedIn link before sending (the server refuses it too, T-ME-03).
  await page.getByRole('textbox', { name: 'LinkedIn' }).fill('linkedin.com/company/not-a-person');
  await page.getByRole('button', { name: 'Save networking' }).click();
  expect(await page.getByLabel('LinkedIn').evaluate((el) => (el as HTMLInputElement).validity.patternMismatch)).toBe(true);
  await page.getByRole('textbox', { name: 'LinkedIn' }).fill('linkedin.com/in/ada-claimed');
  // v0.9.2 (T-NFC-26): Discord and website, both optional. The browser refuses a bad Discord name and keeps what was typed.
  await page.getByRole('textbox', { name: 'Discord username' }).fill('ada#1234');
  await page.getByRole('button', { name: 'Save networking' }).click();
  expect(await page.getByLabel('Discord username').evaluate((el) => (el as HTMLInputElement).validity.patternMismatch)).toBe(true);
  await page.getByRole('textbox', { name: 'Discord username' }).fill('ada.codes');
  await page.getByRole('textbox', { name: 'Website' }).fill('ada'); // no dot: the browser refuses it too
  await page.getByRole('button', { name: 'Save networking' }).click();
  expect(await page.getByLabel('Website').evaluate((el) => (el as HTMLInputElement).validity.patternMismatch)).toBe(true);
  await expect(page.getByRole('textbox', { name: 'Discord username' })).toHaveValue('ada.codes');
  await expect(page.getByRole('textbox', { name: 'LinkedIn' })).toHaveValue('linkedin.com/in/ada-claimed');
  await page.getByRole('textbox', { name: 'Discord username' }).fill('@Ada.Codes');
  await page.getByRole('textbox', { name: 'Website' }).fill('ada.dev');
  await page.getByRole('checkbox', { name: 'Share my name and links on my badge' }).check();
  await page.getByRole('button', { name: 'Save networking' }).click();
  await expect(page.getByText('✓ Saved.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'LinkedIn' })).toHaveValue('https://www.linkedin.com/in/ada-claimed');
  await expect(page.getByRole('textbox', { name: 'Discord username' })).toHaveValue('ada.codes');
  await expect(page.getByRole('textbox', { name: 'Website' })).toHaveValue('https://ada.dev/');
  await a.close();

  // B taps it: A's name and the LinkedIn A chose. The badge also checks A in.
  const b = await browser.newContext({ baseURL: E2E_ORIGIN, permissions: ['clipboard-read', 'clipboard-write'] });
  const bPage = await b.newPage();
  await bPage.goto(tapPath); // no sign-in needed since v0.9
  await expect(bPage.getByRole('heading', { name: 'Ada Fixture' })).toBeVisible();
  await expect(bPage.getByRole('link', { name: /LinkedIn/ })).toHaveAttribute('href', 'https://www.linkedin.com/in/ada-claimed');
  await expect(bPage.getByText('@ada.codes')).toBeVisible();
  await bPage.getByRole('button', { name: 'Copy Discord username' }).click();
  await expect(bPage.getByRole('status')).toHaveText('Discord username copied.'); // announced, not only shown
  expect(await bPage.evaluate(() => navigator.clipboard.readText())).toBe('ada.codes');
  await expect(bPage.getByRole('link', { name: 'ada.dev' })).toHaveAttribute('href', 'https://ada.dev/');
  await expect(bPage.getByRole('button', { name: /This is my badge/ })).toHaveCount(0);
  await b.close();
  expect((await f.badgeScan({ cp: f.cp.D, staff: f.staff.vol1, uid })).code).toBe('ACCEPTED');

  // C is waitlisted: the unlinked badge gives the same directions when signed in.
  const c = await browser.newContext({ baseURL: E2E_ORIGIN });
  const cPage = await c.newPage();
  await createAccount(await emailOf(f.p.C));
  await signIn(cPage, await emailOf(f.p.C), `/profile/${randomUid()}`);
  await expect(cPage.getByRole('heading', { name: 'This badge isn’t linked yet' })).toBeVisible();
  await expect(cPage.getByRole('button', { name: /This is my badge/ })).toHaveCount(0);
  await expect(cPage.getByText('Staff link badges at the check-in desk.')).toBeVisible();
  await expect(cPage.getByRole('link', { name: 'Sign in to link it' })).toHaveCount(0);
  await c.close();
});

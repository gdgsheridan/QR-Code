import { expect, test, type Page } from '@playwright/test';
import { generateToken, sha256hex } from '@/lib/domain/token';
import { E2E_ORIGIN, signIn } from '../fixtures/e2e';
import { createAccount, createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC §15 (v0.11.22): one typeface. Every visible text and form control on every page is in Fira Code, like
// sheridandatathon.com: no Geist, no system font in inputs or buttons.
let f: StandardFixture;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => { f = await createStandardFixture(); });
test.afterAll(async () => { await f.close(); });

async function offenders(page: Page) {
  await page.waitForLoadState('load'); await page.waitForTimeout(1200);
  return page.evaluate(() => {
    const out = new Set<string>();
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const own = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent!.trim());
      const control = /^(INPUT|BUTTON|SELECT|TEXTAREA)$/.test(el.tagName);
      if (!own && !control) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const fam = getComputedStyle(el).fontFamily;
      if (!/Fira Code/.test(fam)) out.add(`${el.tagName}${el instanceof HTMLInputElement ? `[${el.type} ${el.name}]` : ''} "${(el.textContent || (el as HTMLInputElement).value || '').trim().slice(0, 30)}" → ${fam}`);
    }
    return [...out];
  });
}

/** A pending applicant holding a working RSVP link, like the one the invitation email opens. */
async function invitee(name: string) {
  const token = generateToken();
  await f.pool.query(
    `insert into participants (event_id, external_id, email, first_name, last_name, search_text, status, source, rsvp_token_hash)
     values ($1, $2, $3, $4, 'Font', $5, 'pending', 'sheet', $6)`,
    [f.e1.id, `font-${name}`, `${name.toLowerCase()}-${f.slug}@example.test`, name, `${name.toLowerCase()} font`, sha256hex(token)],
  );
  return token;
}

const emailOf = async (id: string) => (await f.pool.query<{ email: string }>('select email from participants where id = $1', [id])).rows[0]!.email;

test('T-UI-01: signed-out pages use only Fira Code', async ({ page }) => {
  const { uid } = await f.linkBadge(f.p.A);
  const report: string[] = [];
  for (const path of ['/login', '/login?error=link', '/rsvp', '/p', '/auth/confirm', `/profile/${uid}`, '/nope-404']) {
    await page.goto(path);
    for (const o of await offenders(page)) report.push(`${path}: ${o}`);
  }
  expect(report).toEqual([]);
});

test('T-UI-01: hacker menu pages use only Fira Code', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: E2E_ORIGIN });
  const page = await ctx.newPage();
  await createAccount(await emailOf(f.p.A));
  await signIn(page, await emailOf(f.p.A), '/me');
  const report: string[] = [];
  for (const path of ['/me', '/me/profile', '/me/profile?tab=event', '/me/profile?tab=health', '/me/profile?setup=1', '/me/emergency', '/me/schedule', '/me/team', '/me/hackers']) {
    await page.goto(path);
    for (const o of await offenders(page)) report.push(`${path}: ${o}`);
  }
  expect(report).toEqual([]);
});

test('T-UI-01: admin and scanner pages use only Fira Code', async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page, f.staffEmail.org1, `/admin/${f.slug}`);
  const report: string[] = [];
  for (const sub of ['', '/participants', '/checkpoints', '/staff', '/info', '/teams', '/export']) {
    await page.goto(`/admin/${f.slug}${sub}`);
    for (const o of await offenders(page)) report.push(`admin${sub}: ${o}`);
  }
  await page.goto(`/scan/${f.slug}`);
  for (const o of await offenders(page)) report.push(`scan: ${o}`);
  expect(report).toEqual([]);
});

test('T-UI-01: the invitation from the email (/rsvp#token) uses only Fira Code at every step', async ({ browser }) => {
  const report: string[] = [];
  const check = async (page: Page, step: string) => { for (const o of await offenders(page)) report.push(`${step}: ${o}`); };
  const yes = await browser.newContext({ baseURL: E2E_ORIGIN });
  const p = await yes.newPage();
  await p.goto(`/rsvp#${await invitee('Yara')}`);
  await expect(p.getByRole('button', { name: 'Yes, I’m coming' })).toBeVisible();
  await check(p, 'invitation');
  await p.getByRole('button', { name: 'Yes, I’m coming' }).click();
  await expect(p.getByLabel('Set a password for your Datathon account')).toBeVisible();
  await check(p, 'password step');
  await p.getByLabel('Set a password for your Datathon account').fill('yara-font-password');
  await p.getByRole('button', { name: 'Yes, I’m coming' }).click();
  await expect(p.getByRole('heading', { name: /You’re in/ })).toBeVisible();
  await check(p, 'you’re in');
  await yes.close();
  const no = await browser.newContext({ baseURL: E2E_ORIGIN });
  const q = await no.newPage();
  await q.goto(`/rsvp#${await invitee('Noor')}`);
  await q.getByRole('button', { name: /No, give my spot away/ }).click();
  await expect(q.getByText(/waitlist/).first()).toBeVisible();
  await check(q, 'no');
  await q.goto(`/p#${f.token.A}`);
  await expect(q.locator('canvas, img').first()).toBeVisible();
  await check(q, 'pass page');
  await no.close();
  expect(report).toEqual([]);
});

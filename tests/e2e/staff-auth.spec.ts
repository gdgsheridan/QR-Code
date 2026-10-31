import { expect, test, type Page } from '@playwright/test';
import { consoleMailText, E2E_ORIGIN, signIn, NO_JS } from '../fixtures/e2e';
import { countMailTo, latestAuthLink } from '../fixtures/mailpit';
import { createAccount, createStandardFixture, STAFF_PASSWORD, type StandardFixture } from '../fixtures/standard';

// SPEC F9 (v0.4): email + password sign-in; invite and reset links lead to "Set your password".
let f: StandardFixture;
test.beforeEach(async () => {
  f = await createStandardFixture();
});
test.afterEach(async () => {
  await f.close();
});

const NEW_PASSWORD = 'a-brand-new-password';

async function requestPasswordLink(page: Page, email: string, next: string): Promise<number> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByRole('button', { name: 'Forgot or never set your password?' }).click();
  const started = Date.now();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a link to set my password' }).click();
  await expect(page.getByText('If that address can sign in here, we sent a link')).toBeVisible();
  return started;
}

// Opens an emailed link, presses Continue, and sets a password.
async function setPasswordFromLink(page: Page, url: string, password: string): Promise<void> {
  await page.goto(url);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Set your password' })).toBeVisible();
  await page.getByLabel('New password').fill(password);
  await page.getByRole('button', { name: 'Save password' }).click();
}

test('T-AUTH-01: email + password goes to next; a wrong password shows one generic error and no session', async ({ page }) => {
  await page.goto(`/login?next=${encodeURIComponent(`/scan/${f.slug}`)}`);
  await page.getByLabel('Email').fill(f.staffEmail.vol1);
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('✕ Wrong email or password.')).toBeVisible();
  await page.goto(`/scan/${f.slug}`);
  await expect(page).toHaveURL(/\/login\?next=/);

  await signIn(page, f.staffEmail.vol1, `/scan/${f.slug}`);
  await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toHaveCount(0);

  // 10 tries per email per 15 min (§15): after 10 wrong passwords even the right one is refused for now.
  const fresh = await page.context().browser()?.newContext({ baseURL: E2E_ORIGIN });
  const guess = await fresh?.newPage();
  if (!fresh || !guess) throw new Error('no browser');
  await guess.goto('/login');
  for (let i = 0; i < 10; i++) {
    await guess.getByLabel('Email').fill(f.staffEmail.vol2);
    await guess.getByLabel('Password').fill(`wrong-${i}`);
    await guess.getByRole('button', { name: 'Sign in' }).click();
    await expect(guess.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  }
  await guess.getByLabel('Email').fill(f.staffEmail.vol2);
  await guess.getByLabel('Password').fill(STAFF_PASSWORD);
  await guess.getByRole('button', { name: 'Sign in' }).click();
  await expect(guess.getByText('✕ Wrong email or password.')).toBeVisible();
  await expect(guess).toHaveURL(/\/login/);
  await fresh.close();
});

test('T-AUTH-02: "Forgot password" resets an account, invites an accepted participant, and sends nothing to strangers', async ({ browser, page }) => {
  // Existing account: a reset link; the new password works and the old one stops working.
  const next = `/scan/${f.slug}`;
  const started = await requestPasswordLink(page, f.staffEmail.vol2, next);
  const reset = await latestAuthLink(f.staffEmail.vol2, started);
  expect(reset.subject).toBe('Reset your Datathon password');
  await setPasswordFromLink(page, reset.url, NEW_PASSWORD);
  await page.waitForURL((url) => url.pathname === next);

  const fresh = await browser.newContext({ baseURL: E2E_ORIGIN });
  const again = await fresh.newPage();
  await signIn(again, f.staffEmail.vol2, next, NEW_PASSWORD);
  await again.context().clearCookies();
  await again.goto('/login');
  await again.getByLabel('Email').fill(f.staffEmail.vol2);
  await again.getByLabel('Password').fill(STAFF_PASSWORD);
  await again.getByRole('button', { name: 'Sign in' }).click();
  await expect(again.getByText('✕ Wrong email or password.')).toBeVisible();
  await fresh.close();

  // An accepted participant without an account (a walk-in, or accepted before v0.4): a first-password invite.
  const { rows } = await f.pool.query<{ email: string }>('select email from participants where id = $1', [f.p.A]);
  const a = rows[0]?.email ?? '';
  const firstAsk = await requestPasswordLink(page, a, '/');
  const invited = await latestAuthLink(a, firstAsk);
  expect(invited.subject).toBe('Set your Datathon password');
  // At most 3 emails per address per hour (§15); a 4th request sends nothing but looks the same.
  // Spaced past the auth server's own 1 s per-address throttle (config.toml max_frequency), so only ours applies.
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(1_100);
    await requestPasswordLink(page, a, '/');
  }
  expect(await countMailTo(a, firstAsk)).toBe(3);

  // Nobody we know: the same message, and no email.
  const stranger = `stranger-${f.slug}@example.test`;
  expect(await countMailTo(stranger, await requestPasswordLink(page, stranger, '/'))).toBe(0);
});

test('T-AUTH-03: inviting a new address emails a link to set a password, then onboarding, then the event', async ({ browser, page }) => {
  await signIn(page, f.staffEmail.org1, `/admin/${f.slug}/staff`);
  const email = `invitee-${f.slug}@example.test`;
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Role').selectOption('organizer');
  const started = Date.now();
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('✓ Invited. We emailed them a link to set their password.');

  // Inviting someone who already has an account adds them straight away. The auth server sends nothing,
  // so the app emails them a link to sign in (v0.11.12).
  await page.getByLabel('Email').fill(f.staffEmail.vol3);
  await page.getByLabel('Role').selectOption('volunteer');
  const existingStarted = Date.now();
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('✓ Added. We emailed them a link to sign in.');
  expect(await consoleMailText(f.staffEmail.vol3, 'Sign in: ')).toContain(`Sign in: ${E2E_ORIGIN}/login?next=/scan/${f.slug}`);
  expect(await countMailTo(f.staffEmail.vol3, existingStarted)).toBe(0);

  const invitee = await browser.newContext({ baseURL: E2E_ORIGIN });
  const p = await invitee.newPage();
  const link = await latestAuthLink(email, started);
  expect(link.subject).toBe('Set your Datathon password');
  // The link's token is in the fragment only, so no server (ours, a proxy, a CDN) ever logs it.
  const linkToken = new URL(link.url).hash.slice(1);
  expect(linkToken.length).toBeGreaterThan(20);
  expect(new URL(link.url).search).not.toContain(linkToken);
  const urls: string[] = [];
  p.on('request', (r) => urls.push(r.url()));
  await setPasswordFromLink(p, link.url, NEW_PASSWORD);
  await expect(p).toHaveURL(/\/onboarding/);
  await p.getByLabel('Display name').fill('Maya');
  await p.getByRole('button', { name: 'Continue' }).click();
  await expect(p).toHaveURL(new RegExp(`/admin/${f.slug}$`));
  expect(urls.filter((u) => u.includes(linkToken))).toEqual([]);
  const { rows } = await f.pool.query('select 1 from staff_invites where email = $1', [email]);
  expect(rows).toHaveLength(0);
  await invitee.close();

  // T-AUTH-04 (reused half): the same link a second time is refused.
  const reuse = await browser.newContext({ baseURL: E2E_ORIGIN });
  const r = await reuse.newPage();
  await r.goto(link.url);
  await r.getByRole('button', { name: 'Continue' }).click();
  await expect(r).toHaveURL(/\/login\?error=link/);
  await reuse.close();
});

test('T-AUTH-01 (forms before hydration): with JavaScript off, sign-in and set-password still work', async ({ browser }) => {
  // A slow phone can submit before React hydrates: the browser then posts the form itself, and the
  // server-action CSRF check needs a real Origin header on that post.
  const noJs = await browser.newContext({ baseURL: E2E_ORIGIN, ...NO_JS });
  const page = await noJs.newPage();
  await page.goto(`/login?next=${encodeURIComponent(`/scan/${f.slug}`)}`);
  await page.getByLabel('Email').fill(f.staffEmail.vol1);
  await page.getByLabel('Password').fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => url.pathname === `/scan/${f.slug}`);

  await page.goto('/set-password?next=%2Fme');
  await page.getByLabel('New password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Save password' }).click();
  await page.waitForURL((url) => url.pathname === '/me');
  await noJs.close();
});

test('T-AUTH-04: a bad set-password link shows an error on the login page', async ({ page }) => {
  await page.goto('/auth/confirm?type=invite&next=/scan/x#not-a-real-token');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/login\?error=link/);
  await expect(page.getByText("That link didn't work or has expired")).toBeVisible();
});

test('T-SCUI-10 (redirect half): a signed-out visit to /scan/<slug> goes to /login and remembers the way back', async ({ page }) => {
  await page.goto(`/scan/${f.slug}`);
  await expect(page).toHaveURL(`/login?next=${encodeURIComponent(`/scan/${f.slug}`)}`);
  await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible();
});

test('T-AUTH-03 (E): when the auth server can’t send the invite, the Staff page says so', async ({ page }) => {
  await signIn(page, f.staffEmail.org1, `/admin/${f.slug}/staff`);
  await page.route(`**/api/admin/${f.slug}/staff/invites`, (r) =>
    r.request().method() === 'POST' ? r.fulfill({ json: { code: 'INVITED', emailed: false } }) : r.continue(),
  );
  await page.getByLabel('Email').fill(`unsent-${f.slug}@example.test`);
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(
    '! Invited, but the email didn’t go out. Ask them to use “Forgot or never set your password?” on the sign-in page.',
  );
});

test('T-AUTH-03 (E): a hacker with an account added as staff signs in from the email, names themselves, and gets both menus', async ({ browser, page }) => {
  const { rows } = await f.pool.query<{ email: string }>('select email from participants where id = $1', [f.p.A]);
  const a = rows[0]?.email ?? '';
  await createAccount(a); // their RSVP Yes made it (F13)
  await signIn(page, f.staffEmail.org1, `/admin/${f.slug}/staff`);
  await page.getByLabel('Email').fill(a);
  await page.getByLabel('Role').selectOption('volunteer');
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('✓ Added. We emailed them a link to sign in.');
  const url = /Sign in: (\S+)/.exec(await consoleMailText(a, 'Sign in: '))?.[1] ?? '';
  expect(url).toBe(`${E2E_ORIGIN}/login?next=/scan/${f.slug}`);

  const hacker = await browser.newContext({ baseURL: E2E_ORIGIN });
  const h = await hacker.newPage();
  await h.goto(url);
  await h.getByLabel('Email').fill(a);
  await h.getByLabel('Password').fill(STAFF_PASSWORD);
  await h.getByRole('button', { name: 'Sign in' }).click();
  // Staff get the display-name step first (F9), then the scanner they were sent to.
  await expect(h).toHaveURL(/\/onboarding/);
  await h.getByLabel('Display name').fill('Ada');
  await h.getByRole('button', { name: 'Continue' }).click();
  await expect(h).toHaveURL(new RegExp(`/scan/${f.slug}$`));
  await expect(h.getByRole('heading', { name: 'Choose your checkpoint' })).toBeVisible();
  // /me keeps their hacker menu and adds the staff links.
  await h.goto('/me');
  await expect(h.getByRole('navigation', { name: 'Hacker menu' })).toBeVisible();
  await expect(h.getByRole('link', { name: `Scanner: ${f.e1.name}` })).toBeVisible();
  await expect(h.getByRole('link', { name: `Admin: ${f.e1.name}` })).toHaveCount(0);
  await hacker.close();
});

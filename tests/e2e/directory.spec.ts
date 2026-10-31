import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { signIn } from '../fixtures/e2e';
import { createAccount, createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
test.beforeAll(async () => { f = await createStandardFixture(); });
test.afterAll(async () => { await f.close(); });
const emailOf = async (id: string) => (await f.pool.query<{ email: string }>('select email from participants where id = $1', [id])).rows[0]!.email;
const screenshots = '/tmp/claude-0/-home-yvesd-Codebases-datathon-Datathon-QR-NFC/7675cf3a-51e9-4cc4-b5e7-a411639544b0/scratchpad';

test('T-DIR-05: opt in through RSVP profile walkthrough, browse/filter/contact, opt out; private HTML and responsive screens', async ({ page, context, browser }) => {
  // Listing is on by default (v0.11.19): start from everyone opted out so the test controls who is listed.
  await f.pool.query('update participants set directory_opt_in = false where event_id = any($1)', [[f.e1.id, f.e2.id]]);
  await f.pool.query(`update participants set directory_opt_in = true, bio = 'Building with open data.\nCome say hello!', pace = 'balanced', linkedin_url = 'https://www.linkedin.com/in/ben-fixture', discord_username = 'ben.codes', website_url = 'https://example.test/' where id = $1`, [f.p.B]);
  await f.pool.query(`update participants set directory_opt_in = true, bio = 'Learning machine learning.', pace = 'casual', looking_for_team = true where id = $1`, [f.p.N]);
  await f.pool.query(`update participants set directory_opt_in = true, bio = 'Another event private bio' where id = $1`, [f.p.X]);
  const legacy = await f.addParticipant(f.e1.id);
  await f.pool.query(`update participants set first_name = 'Legacy', looking_for_team = true, directory_opt_in = false, bio = 'Hidden legacy bio', discord_username = 'hidden.discord' where id = $1`, [legacy.id]);
  for (const [index, pace] of ['casual', 'balanced', 'competitive', null, 'balanced', 'casual'].entries()) {
    const extra = await f.addParticipant(f.e1.id);
    await f.pool.query(`update participants set first_name = $2, directory_opt_in = true, pace = $3, bio = 'Ready to build something together.' where id = $1`, [extra.id, ['Cleo', 'Dev', 'Emi', 'Farah', 'Gus', 'Hana'][index], pace]);
  }
  // The contact is set on its own page (/me/emergency); stored here so the directory can be checked for leaks.
  await f.pool.query(`update participants set emergency_name = 'Private contact sentinel', emergency_phone = '4165550123' where id = $1`, [f.p.A]);
  const email = await emailOf(f.p.A);
  await createAccount(email);
  await signIn(page, email, '/me/profile?setup=1');
  await page.getByRole('radio', { name: 'Not sure yet', exact: true }).check();
  await page.getByRole('radio', { name: 'I plan to go solo', exact: true }).check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Networking', exact: true })).toBeVisible();
  await page.getByLabel('List me in the Hacker directory').check();
  await page.getByLabel('Your pace (optional)').selectOption('competitive');
  await page.getByLabel('Bio (optional)', { exact: true }).fill('I enjoy data visualisation.\n<b>Plain text</b>');
  mkdirSync(screenshots, { recursive: true });
  for (const [width, height] of [[390, 844], [1280, 800]]) {
    await page.setViewportSize({ width: width!, height: height! });
    await page.screenshot({ path: `${screenshots}/directory-networking-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: 'Save links', exact: true }).click();
  await expect(page.getByText('✓ Saved.', { exact: true })).toBeVisible();
  await page.goto('/me');
  await page.getByRole('link', { name: 'Hackers' }).click();
  await expect(page).toHaveURL(/\/me\/hackers$/);
  // Start a fresh document: client navigation retains the previous menu's bootstrap scripts (own email).
  await page.reload();
  const directory = page.getByRole('region', { name: 'Hacker directory', exact: true });
  const self = directory.getByRole('article', { name: 'Ada Fixture (you)' });
  await expect(directory.locator('details[open]')).toHaveCount(0);
  await expect(directory.getByRole('article')).toHaveCount(9);
  await expect(self.getByRole('heading', { name: 'Ada Fixture (you)' })).toBeVisible();
  await expect(self.getByRole('img', { name: 'Pace: Going for the win (3 of 3)', exact: true })).toBeVisible();
  await expect(self.getByText('<b>Plain text</b>', { exact: false })).not.toBeVisible();
  await self.locator('summary').click();
  await expect(self).toContainText('Going for the win');
  await expect(self).toContainText('<b>Plain text</b>');
  await expect(self.locator('b')).toHaveCount(0);
  await expect(self.getByRole('button')).toHaveCount(0);
  await expect(self.getByRole('link')).toHaveCount(0);
  const ben = directory.getByRole('article', { name: 'Ben Fixture', exact: true });
  await expect(ben.getByRole('heading', { name: 'Ben Fixture', exact: true })).toBeVisible();
  await expect(ben.getByRole('img', { name: 'Pace: Balanced (2 of 3)', exact: true })).toBeVisible();
  await expect(directory.getByRole('article', { name: 'Nia Fixture', exact: true }).getByRole('img', { name: 'Pace: Here to learn and meet people (1 of 3)', exact: true })).toBeVisible();
  await expect(directory.getByRole('article', { name: 'Farah Fixture', exact: true }).getByRole('img', { name: 'Pace not set (0 of 3)', exact: true })).toBeVisible();
  for (const [label, filled] of [
    ['Pace: Here to learn and meet people (1 of 3)', 1],
    ['Pace: Balanced (2 of 3)', 2],
    ['Pace: Going for the win (3 of 3)', 3],
    ['Pace not set (0 of 3)', 0],
  ] as const) {
    const gauge = directory.getByRole('img', { name: label, exact: true }).first();
    await expect(gauge).toHaveAttribute('title', label);
    await expect(gauge.locator(':scope > span')).toHaveCount(3);
    await expect(gauge.locator(':scope > span:not(.border-dashed)')).toHaveCount(filled);
  }
  await expect(ben.getByText('Building with open data.', { exact: false })).not.toBeVisible();
  await expect(ben.getByRole('link', { name: 'LinkedIn', includeHidden: true })).not.toBeVisible();
  await expect(ben.getByRole('link', { name: /https:\/\/example.test/, includeHidden: true })).not.toBeVisible();
  await expect(ben.getByRole('button', { name: 'Copy Ben Fixture’s Discord username', includeHidden: true })).not.toBeVisible();
  await ben.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(ben.locator('details')).toHaveAttribute('open', '');
  await expect(ben.getByText('Building with open data.', { exact: false })).toBeVisible();
  await expect(ben.getByText('Balanced', { exact: true })).toBeVisible();
  await self.locator('summary').click();
  await expect(ben.getByRole('link', { name: 'LinkedIn' })).toHaveAttribute('href', 'https://www.linkedin.com/in/ben-fixture');
  await expect(ben.getByRole('link', { name: /https:\/\/example.test/ })).toHaveAttribute('rel', 'nofollow ugc');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ben.getByRole('button', { name: 'Copy Ben Fixture’s Discord username' }).click();
  await expect(ben.getByRole('status')).toContainText('Discord username copied.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('ben.codes');
  const noJs = await browser.newContext({ storageState: await context.storageState(), javaScriptEnabled: false, baseURL: page.url() });
  const nativePage = await noJs.newPage();
  await nativePage.goto('/me/hackers');
  const nativeBen = nativePage.getByRole('article', { name: 'Ben Fixture', exact: true });
  await expect(nativeBen.getByText('Building with open data.', { exact: false })).not.toBeVisible();
  await nativeBen.locator('summary').click();
  await expect(nativeBen.getByText('Building with open data.', { exact: false })).toBeVisible();
  await noJs.close();
  const html = await page.content();
  for (const secret of [email, 'Private contact sentinel', '4165550123', 'Another event private bio', 'Hidden legacy bio', 'hidden.discord']) expect(html).not.toContain(secret);
  await expect(directory.getByText('Legacy Fixture')).toHaveCount(0);
  for (const [width, height, columns] of [[390, 844, 1], [768, 900, 2], [1100, 900, 3], [1280, 800, 3], [1440, 900, 4]]) {
    await page.setViewportSize({ width: width!, height: height! });
    expect(await directory.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(columns);
    const rowHeights = await directory.getByRole('article').evaluateAll((rows) => rows.slice(0, 2).map((row) => row.getBoundingClientRect().height));
    expect(rowHeights[1]!).toBeGreaterThan(rowHeights[0]!);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `${screenshots}/dir-accordion-${width}.png`, fullPage: true });
    await ben.screenshot({ path: `${screenshots}/directory-contacts-${width}.png` });
  }
  await page.getByLabel('Looking for a team', { exact: true }).check();
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(directory.getByText('Legacy Fixture')).toBeVisible();
  await expect(directory.getByRole('article', { name: 'Legacy Fixture', exact: true }).getByRole('img', { name: 'Pace not shared (0 of 3)', exact: true })).toBeVisible();
  await expect(directory).not.toContainText('Hidden legacy bio');
  await expect(directory.getByText('Ben Fixture')).toHaveCount(0);
  await page.getByLabel('Pace', { exact: true }).selectOption('casual');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(directory.getByText('Nia Fixture')).toBeVisible();
  await expect(directory.getByText('Legacy Fixture')).toHaveCount(0);
  await page.goto('/me/hackers');
  await page.getByLabel('Search by name').fill('  BÉN  ');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(ben).toBeVisible();
  await expect(directory.getByText('Nia Fixture')).toHaveCount(0);
  await page.goto('/me/team');
  await expect(page.getByRole('link', { name: 'Find teammates in the Hacker directory' })).toHaveAttribute('href', '/me/hackers?looking=1');
  for (const [width, height] of [[390, 844], [1280, 800]]) {
    await page.setViewportSize({ width: width!, height: height! });
    await page.screenshot({ path: `${screenshots}/directory-team-${width}.png`, fullPage: true });
  }
  await page.goto('/me/profile');
  await page.getByRole('navigation', { name: 'Profile sections' }).getByRole('link', { name: 'Networking', exact: true }).click();
  await page.getByLabel('List me in the Hacker directory').uncheck();
  await page.getByRole('button', { name: 'Save links', exact: true }).click();
  await expect(page.getByText('✓ Saved.', { exact: true })).toBeVisible();
  await page.goto('/me/hackers');
  await expect(directory.getByText('Ada Fixture')).toHaveCount(0);
});

test('T-DIR-06: waitlisted and withdrawn viewers get 404; signed-out visitors must sign in', async ({ page, browser }) => {
  await page.goto('/me/hackers');
  await expect(page).toHaveURL(/\/login\?next=%2Fme%2Fhackers/);
  for (const id of [f.p.C, f.p.Wd]) {
    const context = await browser.newContext();
    const viewer = await context.newPage();
    const email = await emailOf(id);
    await createAccount(email);
    await signIn(viewer, email, '/me');
    expect((await viewer.goto('/me/hackers'))?.status()).toBe(404);
    await context.close();
  }
});

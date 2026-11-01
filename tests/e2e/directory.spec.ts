import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { signIn, NO_JS } from '../fixtures/e2e';
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
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByLabel('Emergency contact name').fill('Dee Fixture');
  await page.getByLabel('Emergency contact phone').fill('416 555 0101');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Networking', exact: true })).toBeVisible();
  await page.getByLabel('List me in the Hacker directory').check();
  await page.getByLabel('Prefer not to say', { exact: true }).uncheck();
  await page.getByRole('slider', { name: 'Your pace', exact: true }).press('End');
  await expect(page.getByRole('slider', { name: 'Your pace', exact: true })).toHaveAttribute('aria-valuetext', 'Going for the win');
  await page.getByLabel('Bio', { exact: true }).fill('I enjoy data visualisation.\n<b>Plain text</b>');
  mkdirSync(screenshots, { recursive: true });
  for (const [width, height] of [[390, 844], [1280, 800]]) {
    await page.setViewportSize({ width: width!, height: height! });
    await page.screenshot({ path: `${screenshots}/directory-networking-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: 'Save and finish', exact: true }).click();
  await page.waitForURL(/\/me$/);
  await page.getByRole('link', { name: 'Hackers' }).click();
  await expect(page).toHaveURL(/\/me\/hackers$/);
  // Start a fresh document: client navigation retains the previous menu's bootstrap scripts (own email).
  await page.reload();
  const directory = page.getByRole('region', { name: 'Hacker directory', exact: true });
  await expect(page.getByRole('link', { name: 'Edit my directory profile →' })).toHaveAttribute('href', '/me/profile?tab=networking');
  await expect(page.getByText('Pace bar: 1 = here to learn, 2 = balanced, 3 = going for the win.')).toBeVisible();
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
  await expect(ben.getByRole('link', { name: /^example\.test/, includeHidden: true })).not.toBeVisible();
  await expect(ben.getByRole('button', { name: 'Copy Ben Fixture’s Discord username', includeHidden: true })).not.toBeVisible();
  await ben.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(ben.locator('details')).toHaveAttribute('open', '');
  await expect(ben.getByText('Building with open data.', { exact: false })).toBeVisible();
  await expect(ben.getByText('Balanced', { exact: true })).toBeVisible();
  await self.locator('summary').click();
  await expect(ben.getByRole('link', { name: 'LinkedIn' })).toHaveAttribute('href', 'https://www.linkedin.com/in/ben-fixture');
  await expect(ben.getByRole('link', { name: /^example\.test/ })).toHaveAttribute('rel', 'nofollow ugc');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ben.getByRole('button', { name: 'Copy Ben Fixture’s Discord username' }).click();
  await expect(ben.getByRole('status')).toContainText('Discord username copied.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('ben.codes');
  const noJs = await browser.newContext({ storageState: await context.storageState(), ...NO_JS, baseURL: page.url() });
  const nativePage = await noJs.newPage();
  await nativePage.goto('/me/hackers');
  const nativeBen = nativePage.getByRole('article', { name: 'Ben Fixture', exact: true });
  await expect(nativeBen.getByText('Building with open data.', { exact: false })).not.toBeVisible();
  await nativeBen.locator('summary').click();
  await expect(nativeBen.getByText('Building with open data.', { exact: false })).toBeVisible();
  await nativePage.getByRole('slider', { name: 'Pace', exact: true }).press('Home');
  await nativePage.getByRole('slider', { name: 'Pace', exact: true }).press('ArrowRight');
  await nativePage.getByLabel('Search by name').press('Enter'); // no JavaScript: Enter submits the GET form
  await expect(nativePage).toHaveURL(/pace=1/);
  await expect(nativePage.getByRole('slider', { name: 'Pace', exact: true })).toHaveAttribute('aria-valuetext', 'Here to learn and meet people');
  await expect(nativePage.getByRole('slider', { name: 'Pace', exact: true })).toHaveValue('1');
  await expect(nativePage.getByRole('article', { name: 'Nia Fixture', exact: true })).toBeVisible();
  await expect(nativeBen).toHaveCount(0);
  await nativePage.getByRole('slider', { name: 'Pace', exact: true }).press('Home');
  await nativePage.getByLabel('Search by name').press('Enter'); // no JavaScript: Enter submits the GET form
  await expect(nativePage).toHaveURL(/pace=0/);
  await expect(nativePage.getByRole('slider', { name: 'Pace', exact: true })).toHaveAttribute('aria-valuetext', 'Any pace');
  await expect(nativeBen).toBeVisible();
  // Without JavaScript, Apply submits the checkbox too.
  await nativePage.getByLabel('Looking for a team', { exact: true }).check();
  await nativePage.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(nativePage).toHaveURL(/looking=1/);
  await expect(nativeBen).toHaveCount(0);
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
  // v0.11.25: filters apply as they change; no Apply button.
  await expect(page.getByRole('button', { name: 'Apply filters' })).toHaveCount(0);
  await page.getByLabel('Looking for a team', { exact: true }).check();
  await expect(page).toHaveURL(/looking=1/);
  await expect(directory.getByText('Legacy Fixture')).toBeVisible();
  const legacyCard = directory.getByRole('article', { name: 'Legacy Fixture', exact: true });
  await expect(legacyCard.getByRole('img', { name: 'Pace not shared (0 of 3)', exact: true })).toBeVisible();
  await legacyCard.locator('summary').click();
  await expect(legacyCard).toContainText('Looking for a team');
  await expect(directory).not.toContainText('Hidden legacy bio');
  await expect(directory.getByText('Ben Fixture')).toHaveCount(0);
  await page.getByRole('slider', { name: 'Pace', exact: true }).press('Home');
  await page.getByRole('slider', { name: 'Pace', exact: true }).press('ArrowRight');
  await expect(page.getByRole('slider', { name: 'Pace', exact: true })).toHaveAttribute('aria-valuetext', 'Here to learn and meet people');
  // v0.11.25: filters apply as they change (no Apply button).
  await expect(page).toHaveURL(/pace=1/);
  // The slider isn't remounted by the navigation, so keyboard focus stays on it.
  await expect(page.getByRole('slider', { name: 'Pace', exact: true })).toBeFocused();
  await expect(directory.getByText('Nia Fixture')).toBeVisible();
  await expect(directory.getByText('Legacy Fixture')).toHaveCount(0);
  await page.goto('/me/hackers?looking=1&pace=casual');
  await expect(page.getByRole('slider', { name: 'Pace', exact: true })).toHaveValue('1');
  await expect(directory.getByText('Nia Fixture')).toBeVisible();
  await expect(directory.getByText('Legacy Fixture')).toHaveCount(0);
  await page.goto('/me/hackers');
  await page.getByLabel('Search by name').fill('  BÉN  ');
  await expect(page).toHaveURL(/q=/); // shortly after typing stops
  await expect(page.getByLabel('Search by name')).toBeFocused();
  await expect(ben).toBeVisible();
  // Refresh reloads the list, then rests for a few seconds.
  const refresh = page.getByRole('button', { name: 'Refresh' });
  await refresh.click();
  await expect(refresh).toBeDisabled();
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
  await page.getByRole('button', { name: 'Save networking', exact: true }).click();
  await expect(page.getByText('✓ Saved.', { exact: true })).toBeVisible();
  await page.goto('/me/hackers');
  await expect(directory.getByText('Ada Fixture')).toHaveCount(0);
  // Invite from a filtered list: back to the same filters and the card, which now says Invited.
  const { rows: [team] } = await f.pool.query<{ id: string }>(`insert into teams (event_id, name, join_code) values ($1, 'Directory team', 'DRCTRYTM') returning id`, [f.e1.id]);
  await f.pool.query('update participants set team_id = $2 where id = $1', [f.p.A, team!.id]);
  await f.pool.query('update events set teams_open = true where id = $1', [f.e1.id]);
  await page.goto('/me/hackers?looking=1&pace=1');
  const nia = directory.getByRole('article', { name: 'Nia Fixture', exact: true });
  await expect(nia.locator('details[open]')).toHaveCount(0);
  await nia.getByRole('button', { name: 'Invite Nia Fixture' }).click(); // visible without expanding
  await expect(page).toHaveURL(new RegExp(`looking=1&pace=1&r=INVITED#h-${f.p.N}$`));
  await expect(page.getByRole('status').filter({ hasText: 'Invite sent' })).toBeVisible();
  await expect(nia).toContainText('✓ Invited');
  await expect(nia.getByRole('button', { name: 'Invite Nia Fixture' })).toHaveCount(0);
  // Only Looking on, and nobody looking: say so plainly.
  await f.pool.query('update participants set looking_for_team = false where event_id = $1', [f.e1.id]);
  await page.goto('/me/hackers?looking=1');
  await expect(directory.getByText('Nobody is looking for a team right now.')).toBeVisible();
  await f.pool.query('update participants set team_id = null where id = $1', [f.p.A]);
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

test('T-DIR-05 (v0.11.25): the directory shows 50 hackers, and Show more adds the next 50', async ({ page }) => {
  await f.pool.query(
    `insert into participants (event_id, email, first_name, last_name, search_text, status, source, directory_opt_in)
     select $1, 'more' || g || '-' || $2 || '@example.test', 'Bulk', 'Hacker' || lpad(g::text, 2, '0'), 'bulk hacker' || lpad(g::text, 2, '0'),
            'accepted', 'seed', true from generate_series(1, 60) g`, [f.e2.id, f.slug]);
  // Event 2 (X's), so the other directory tests in this file never see these 60.
  const email = (await f.pool.query<{ email: string }>('select email from participants where id = $1', [f.p.X])).rows[0]!.email;
  await createAccount(email);
  await signIn(page, email, '/me/hackers');
  const cards = page.getByRole('region', { name: 'Hacker directory' }).getByRole('article');
  await expect(cards).toHaveCount(50);
  await page.getByRole('link', { name: 'Show more' }).click();
  await page.waitForURL(/show=100/);
  await expect(cards.nth(50)).toBeVisible();
  expect(await cards.count()).toBeGreaterThan(60);
  await expect(page.getByRole('link', { name: 'Show more' })).toHaveCount(0);
  await f.pool.query(`delete from participants where event_id = $1 and email like 'more%'`, [f.e2.id]);
});

test('T-DIR-05 (v0.11.25): directory reads are rate limited per hacker', async ({ page }) => {
  // Its own hacker: T-DIR-06 already made accounts for C and Wd in this file.
  const email = `limit-${f.slug}@example.test`;
  const { rows } = await f.pool.query<{ id: string }>(
    `insert into participants (event_id, email, first_name, last_name, search_text, status, source, directory_opt_in)
     values ($1, $2, 'Lim', 'Hacker', 'lim hacker', 'accepted', 'seed', false) returning id`, [f.e1.id, email]);
  const id = rows[0]!.id;
  await createAccount(email);
  await signIn(page, email, '/me');
  await f.pool.query(
    `insert into rate_limits (key, window_start, hits) values ($1, to_timestamp(floor(extract(epoch from now()) / 60) * 60), 1000)
     on conflict (key, window_start) do update set hits = 1000`, [`directory:${id}`]);
  await page.goto('/me/hackers');
  await expect(page.getByRole('alert').filter({ hasText: 'Too many refreshes' })).toHaveText('Too many refreshes. Wait a minute, then try again.');
  await expect(page.getByRole('region', { name: 'Hacker directory' }).getByRole('article')).toHaveCount(0);
});

test('T-DIR-07: Teams tab searches team names and shows counts with only opted-in member names', async ({ page }) => {
  const viewer = await f.addParticipant(f.e1.id);
  const privateMember = await f.addParticipant(f.e1.id);
  const email = await emailOf(viewer.id);
  const team = (await f.pool.query<{ id: string }>(
    `insert into teams(event_id, name, join_code) values ($1, 'Zoë Builders', 'STUVWXYZ') returning id`, [f.e1.id],
  )).rows[0]!.id;
  await f.pool.query(`update participants set team_id = $1, first_name = 'Listed', directory_opt_in = true where id = $2`, [team, viewer.id]);
  await f.pool.query(`update participants set team_id = $1, first_name = 'Private sentinel', directory_opt_in = false where id = $2`, [team, privateMember.id]);
  await f.pool.query('update events set tracks_released = false where id = $1', [f.e1.id]);
  await createAccount(email);
  await signIn(page, email, '/me/hackers');
  const tabs = page.getByRole('navigation', { name: 'Directory sections' });
  await expect(tabs.getByRole('link', { name: 'Hackers', exact: true })).toHaveAttribute('aria-current', 'page');
  await tabs.getByRole('link', { name: 'Teams', exact: true }).click();
  await expect(page).toHaveURL(/view=teams/);
  await expect(tabs.getByRole('link', { name: 'Teams', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByLabel('Search by team name', { exact: true }).fill('  ZÓE  ');
  await expect(page).toHaveURL(/q=/);
  await expect(page).toHaveURL(/view=teams/);
  const card = page.getByRole('article', { name: 'Zoë Builders (your team)', exact: true });
  await expect(card).toContainText('2 of 4 members');
  await expect(card).toContainText('2 spots left');
  await expect(card).toContainText('Listed Fixture (you)');
  await expect(card).toContainText('+1 more');
  await expect(page.getByRole('region', { name: 'Team directory' })).not.toContainText('Private sentinel');
  await expect(page.getByLabel('Track', { exact: true })).toHaveCount(0);
  await expect(card.getByRole('button')).toHaveCount(0);
  await expect(card.getByRole('link')).toHaveCount(1);
  await expect(card.getByRole('link', { name: 'Open my team →', exact: true })).toHaveAttribute('href', '/me/team');
});

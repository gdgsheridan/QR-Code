import { mkdirSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { E2E_ORIGIN, signIn } from '../fixtures/e2e';
import { createAccount, createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC F14 (v0.6): the hacker menu: own badge → menu → profile, schedule, emergency contact, pass.
let f: StandardFixture;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  f = await createStandardFixture();
});
test.afterAll(async () => {
  await f.close();
});

const emailOf = async (participantId: string) =>
  (await f.pool.query<{ email: string }>('select email from participants where id = $1', [participantId])).rows[0]?.email ?? '';

test('T-ADM-08: Info edits only the RSVP deadline; schedule and emergency info are set through the API', async ({ page }) => {
  await signIn(page, f.staffEmail.org1, `/admin/${f.slug}`);
  const info = { schedule: 'Sat 9:00  Doors\nSat 12:00  Lunch', emergencyInfo: 'Call Ade: 416 555 0199' };
  const saved = await page.request.patch(`/api/admin/${f.slug}/event`, { data: info });
  expect(saved.ok()).toBe(true);
  await page.getByRole('link', { name: 'Info', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Event info' })).toBeVisible();
  const deadline = page.getByLabel(/RSVP deadline/);
  await expect(deadline).toBeVisible();
  await expect(page.getByLabel('Schedule', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Emergency info', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Emergency information' })).toHaveCount(0);
  await expect(page.locator('textarea')).toHaveCount(0);
  await deadline.fill('2099-11-01T12:00');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('✓ Saved.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(deadline).toHaveValue('2099-11-01T12:00');
  expect(await (await page.request.get(`/api/admin/${f.slug}/event`)).json()).toMatchObject(info);
  await deadline.fill('');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('✓ Saved.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(deadline).toHaveValue('');
  expect(await (await page.request.get(`/api/admin/${f.slug}/event`)).json()).toMatchObject({ ...info, rsvpDeadline: null });
});

test('T-ME-07 / T-NFC-22: A taps their own badge → menu → edits profile and emergency contact, reads the schedule; others see the badge as before', async ({ browser }) => {
  const { uid } = await f.linkBadge(f.p.A);
  const a = await browser.newContext({ baseURL: E2E_ORIGIN });
  const page = await a.newPage();
  await createAccount(await emailOf(f.p.A));
  // Signed out, the menu sends you to sign in and back (proxy.ts covers /me/*).
  await page.goto('/me/profile');
  await expect(page).toHaveURL(/\/login\?next=%2Fme%2Fprofile/);
  await signIn(page, await emailOf(f.p.A), `/profile/${uid}?tap`);
  await page.waitForURL('**/me'); // no event slug in the URL (v0.6.1)

  const menu = page.getByRole('navigation', { name: 'Hacker menu' });
  for (const item of ['Hacker profile', 'Schedule', 'Emergency contact']) await expect(menu.getByRole('link', { name: item })).toBeVisible();
  // Menu order (v0.11.18): Hackers, Schedule, Team, Emergency contact, Hacker profile.
  const order = await menu.locator('li a').evaluateAll(links => links.map(link => link.getAttribute('href')));
  expect(order).toEqual(['/me/hackers', '/me/schedule', '/me/team', '/me/emergency', '/me/profile']);
  await expect(menu.getByText('My pass')).toBeVisible();
  await expect(menu.getByText('In your email')).toBeVisible(); // A's fixture pass predates derived tokens
  await expect(menu.getByText('Finish setting up')).toBeVisible(); // v0.9: no profile setup yet

  await menu.getByRole('link', { name: 'Hacker profile' }).click();
  await page.getByRole('navigation', { name: 'Profile sections' }).getByRole('link', { name: 'Networking', exact: true }).click();
  await expect(page.getByText('Ada Fixture')).toBeVisible();
  await expect(page.getByText('✓ Badge linked.', { exact: true })).toBeVisible();
  // v0.8.2: dietary notes are the Sheet's, for organizers only; saving the profile must not clear them.
  await expect(page.getByLabel('Dietary notes')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save links' }).click();
  await expect(page.getByText('✓ Saved.')).toBeVisible();

  await page.getByRole('link', { name: '← Menu' }).click();
  await page.getByRole('link', { name: 'Schedule' }).click();
  await expect(page.getByText(/Sat 9:00\s+Doors\s+Sat 12:00\s+Lunch/)).toBeVisible();
  expect(await page.getByText(/Sat 9:00/).evaluate((el) => (el as HTMLElement).innerText)).toContain('Doors\nSat 12:00'); // line breaks kept

  await page.getByRole('link', { name: '← Menu' }).click();
  await page.getByRole('link', { name: 'Emergency contact' }).click();
  await expect(page.getByText('Call Ade: 416 555 0199')).toBeVisible();
  await page.getByLabel('Name').fill('Sam Fixture');
  // A phone that isn't one is caught in the browser: nothing is sent and the typed name stays.
  await page.getByLabel('Phone').fill('call me maybe');
  await page.getByRole('button', { name: 'Save' }).click();
  expect(await page.getByLabel('Phone').evaluate((el) => (el as HTMLInputElement).validity.patternMismatch)).toBe(true);
  await expect(page.getByLabel('Name')).toHaveValue('Sam Fixture');
  for (const ok of ['+1 (416) 555-0100', '416.555.0100']) {
    await page.getByLabel('Phone').fill(ok);
    expect(await page.getByLabel('Phone').evaluate((el) => (el as HTMLInputElement).validity.valid), ok).toBe(true);
  }
  await page.getByLabel('Phone').fill('12');
  expect(await page.getByLabel('Phone').evaluate((el) => (el as HTMLInputElement).validity.valid)).toBe(false);
  await page.getByLabel('Phone').fill('+1 (416) 555-0100');
  await page.getByLabel('Relationship (optional)').fill('Brother');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('✓ Saved.')).toBeVisible();
  const { rows } = await f.pool.query('select dietary_notes, emergency_name, emergency_phone, emergency_relation from participants where id = $1', [f.p.A]);
  expect(rows).toEqual([{ dietary_notes: 'Vegetarian', emergency_name: 'Sam Fixture', emergency_phone: '+1 (416) 555-0100', emergency_relation: 'Brother' }]);
  await a.close();

  // B taps A's badge: A's shared profile (on by default since v0.9), never A's menu.
  const b = await browser.newContext({ baseURL: E2E_ORIGIN });
  const bPage = await b.newPage();
  await createAccount(await emailOf(f.p.B));
  await signIn(bPage, await emailOf(f.p.B), `/profile/${uid}?tap`);
  await expect(bPage.getByRole('heading', { name: 'Ada Fixture' })).toBeVisible();
  // C is waitlisted: no menu, and its pages 404.
  await b.close();
  const c = await browser.newContext({ baseURL: E2E_ORIGIN });
  const cPage = await c.newPage();
  await createAccount(await emailOf(f.p.C));
  await signIn(cPage, await emailOf(f.p.C), '/me');
  await expect(cPage.getByRole('heading', { name: 'My events' })).toBeVisible();
  await expect(cPage.getByRole('navigation', { name: 'Hacker menu' })).toHaveCount(0);
  expect((await cPage.goto('/me/profile'))?.status()).toBe(404);
  await c.close();
});

test('T-ADM-08: the organizer sees the emergency contact on the participant detail', async ({ page }) => {
  await signIn(page, f.staffEmail.org1, `/admin/${f.slug}/participants`);
  await page.getByRole('button', { name: 'Details for Ada Fixture' }).click();
  await expect(page.getByText('Emergency contact')).toBeVisible();
  await expect(page.getByRole('link', { name: '+1 (416) 555-0100' })).toHaveAttribute('href', 'tel:+14165550100');
  await expect(page.getByText(/Sam Fixture \(Brother\)/)).toBeVisible();
});


test('T-ME-11: poster calendar keeps all events, poster columns with stacked overlaps and phone day controls', async ({ page }) => {
  const schedule = readFileSync(new URL('../fixtures/schedule/official.txt', import.meta.url), 'utf8');
  await signIn(page, f.staffEmail.org1, `/admin/${f.slug}`);
  const saved = await page.request.patch(`/api/admin/${f.slug}/event`, { data: { schedule } });
  expect(saved.ok()).toBe(true);
  await signIn(page, await emailOf(f.p.A), '/me/schedule');
  await page.setViewportSize({ width: 1440, height: 900 });
  const saturday = page.getByRole('list', { name: 'Saturday, Nov 7', exact: true });
  const sunday = page.getByRole('list', { name: 'Sunday, Nov 8', exact: true });
  await expect(saturday.getByRole('listitem')).toHaveCount(23);
  await saturday.getByRole('listitem').first().scrollIntoViewIfNeeded();
  const heights = await saturday.getByRole('listitem').evaluateAll(blocks => blocks.map(block => block.getBoundingClientRect().height));
  expect(Math.min(...heights)).toBe(30); // SPEC F14: 30-minute slots on a 64px/hour axis, minus the 2px gap.
  const calendar = page.getByRole('region', { name: 'Sat Nov 7 calendar' });
  await expect(calendar).toHaveCSS('background-color', 'rgb(10, 16, 41)'); // v0.11.21: the site's dark surface on desktop too
  if (process.env.HOVER_SCREENSHOTS) await page.screenshot({ path: `${process.env.HOVER_SCREENSHOTS}/schedule-desktop.png`, fullPage: true });
  const hour = calendar.getByText('10 AM', { exact: true });
  await expect(hour).toHaveCSS('font-size', '13px');
  await expect(hour).toHaveCSS('text-align', 'center');
  await expect(hour).toHaveCSS('width', '64px');
  const ten = (await hour.boundingBox())!;
  const eleven = (await calendar.getByText('11 AM', { exact: true }).boundingBox())!;
  expect(eleven.y - ten.y).toBeCloseTo(64, 1);
  const line = (await hour.locator('..').boundingBox())!;
  expect(ten.y + ten.height / 2).toBeCloseTo(line.y + line.height / 2, 1);
  const sundayCalendar = page.getByRole('region', { name: 'Sun Nov 8 calendar' });
  const sundayTen = (await sundayCalendar.getByText('10 AM', { exact: true }).boundingBox())!;
  expect(sundayTen.y).toBeCloseTo(ten.y, 1); // Desktop keeps matching hours aligned across days.
  await expect(hour).toHaveCSS('font-variant-numeric', 'tabular-nums');
  await expect(sundayCalendar.getByText('4 PM', { exact: true })).toBeVisible();
  await expect(sundayCalendar.getByText('5 PM', { exact: true })).toHaveCount(0);
  const sundayEnd = (await sundayCalendar.getByText('4 PM', { exact: true }).boundingBox())!;
  const sundayGrid = (await sundayCalendar.boundingBox())!;
  expect(sundayGrid.y + sundayGrid.height - (sundayEnd.y + sundayEnd.height / 2)).toBeCloseTo(24.5, 1);
  const hacking = (await saturday.getByRole('listitem').filter({ hasText: 'Hacking Begins!' }).boundingBox())!;
  const formation = (await saturday.getByRole('listitem').filter({ hasText: 'Team formation' }).boundingBox())!;
  expect(formation.y - hacking.y - hacking.height).toBeCloseTo(2, 1);
  // Like the Hacker Package poster: workshops share one column and Lunch stacks on top of Hacking Begins.
  const workshopBoxes = await saturday.getByRole('listitem').filter({ hasText: 'Workshop:' }).evaluateAll(blocks => blocks.map(block => {
    const box = block.getBoundingClientRect();
    return [box.x, box.width];
  }));
  expect(workshopBoxes).toHaveLength(5);
  expect(new Set(workshopBoxes.map(box => box.join()))).toHaveProperty('size', 1);
  const lunch = (await saturday.getByRole('listitem').filter({ hasText: 'Lunch' }).boundingBox())!;
  expect(lunch.x).toBeLessThan(hacking.x + hacking.width);
  expect(lunch.y).toBeLessThan(hacking.y + hacking.height);
  expect(lunch.y).toBeGreaterThan(hacking.y);
  // Photo Booth (12–8) is drawn from 1 PM, an hour below Sponsor Station, but still says 12:00 PM.
  const sponsor = (await saturday.getByRole('listitem').filter({ hasText: 'Sponsor Station' }).boundingBox())!;
  const booth = saturday.getByRole('listitem').filter({ hasText: 'Photo Booth' });
  expect((await booth.boundingBox())!.y - sponsor.y).toBeCloseTo(64, 0);
  await expect(booth).toContainText('12:00 PM to 8:00 PM');
  if (process.env.HOVER_SCREENSHOTS) await page.screenshot({ path: `${process.env.HOVER_SCREENSHOTS}/hover-calendar-axis.png`, clip: { x: ten.x, y: ten.y - 64, width: 160, height: 256 } });
  await expect(sunday.getByRole('listitem')).toHaveCount(6);
  await expect(page.getByRole('heading', { name: 'SAT NOV 7' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'SUN NOV 8' })).toBeVisible();
  await expect(saturday.getByText('Magic: The Gathering', { exact: true })).toBeVisible();
  await expect(sunday.getByText('Demos + Judging', { exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Event categories' }).getByRole('listitem')).toHaveCount(5);
  // The busier day gets the wider column.
  const satWidth = (await page.getByRole('region', { name: 'Sat Nov 7 calendar' }).boundingBox())!.width;
  const sunWidth = (await page.getByRole('region', { name: 'Sun Nov 8 calendar' }).boundingBox())!.width;
  expect(satWidth).toBeGreaterThan(sunWidth * 1.5);
  // Each event opens a dialog with its details; Escape or Close returns focus to it.
  const workshop = saturday.getByRole('listitem').filter({ hasText: 'Workshop: Google' });
  const opener = workshop.getByRole('button');
  await expect(workshop).toContainText('ADK, MCP & Cloud DBs');
  await expect(workshop).toContainText('2:30 PM to 3:30 PM · 5F');
  await expect(workshop).toContainText('Workshops');
  await opener.scrollIntoViewIfNeeded();
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Workshop: Google' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('ADK, MCP & Cloud DBs');
  await expect(dialog).toContainText('Saturday, Nov 7');
  await expect(dialog).toContainText('2:30 PM to 3:30 PM');
  await expect(dialog).toContainText('(1 h)');
  await expect(dialog).toContainText('5F');
  await expect(dialog).toContainText('Workshops');
  // The dialog follows the site: dark popover, light title, Fira Code (v0.11.21).
  await expect(dialog.getByRole('heading', { name: 'Workshop: Google' })).toHaveCSS('color', 'rgb(232, 242, 255)');
  await expect(dialog).toHaveCSS('background-color', 'rgb(10, 16, 41)');
  await expect(dialog).toHaveCSS('font-family', /Fira Code/);
  if (process.env.HOVER_SCREENSHOTS) await page.screenshot({ path: `${process.env.HOVER_SCREENSHOTS}/event-dialog-desktop.png` });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  const satButton = page.getByRole('button', { name: 'Sat Nov 7', exact: true });
  const sunButton = page.getByRole('button', { name: 'Sun Nov 8', exact: true });
  await satButton.click();
  await expect(satButton).toHaveAttribute('aria-pressed', 'true');
  await expect(saturday).toBeVisible();
  await expect(sunday).toBeHidden();
  await sunButton.click();
  await expect(sunButton).toHaveAttribute('aria-pressed', 'true');
  await expect(sunday).toBeVisible();
  await expect(saturday).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await sunButton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test('T-ME-11: on a phone, tapping an event opens its details inside the viewport; a tap outside closes them', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: E2E_ORIGIN, viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  try {
    await signIn(page, await emailOf(f.p.A), '/me/schedule');
    await page.getByRole('button', { name: 'Sat Nov 7', exact: true }).click();
    const calendar = page.getByRole('region', { name: 'Sat Nov 7 calendar' });
    const block = calendar.getByRole('listitem').filter({ hasText: 'Caricatures' });
    await block.scrollIntoViewIfNeeded();
    await block.getByRole('button').tap();
    const dialog = page.getByRole('dialog', { name: 'Caricatures' });
    await expect(dialog).toContainText('6:00 PM to 9:00 PM');
    await expect(dialog).toContainText('(3 h)');
    await expect(dialog).toContainText('1F');
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(8);
    expect(box.x + box.width).toBeLessThanOrEqual(382);
    expect(box.y).toBeGreaterThanOrEqual(8);
    expect(box.y + box.height).toBeLessThanOrEqual(836);
    if (process.env.HOVER_SCREENSHOTS) await page.screenshot({ path: `${process.env.HOVER_SCREENSHOTS}/event-dialog-phone.png` });
    await page.touchscreen.tap(195, 20); // the backdrop
    await expect(dialog).toBeHidden();
    await block.getByRole('button').tap();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  } finally { await context.close(); }
});

test('T-ME-11: live event-time marker updates each minute and past events are grey', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-07T19:40:00Z') });
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, await emailOf(f.p.A), '/me/schedule');
  const line = page.getByTestId('schedule-now');
  await expect(line).toContainText('now 2:40 PM');
  await expect(line).toHaveCSS('pointer-events', 'none');
  await expect(page.getByRole('button', { name: 'Sat Nov 7', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const saturday = page.getByRole('list', { name: 'Saturday, Nov 7', exact: true });
  const morning = saturday.getByRole('listitem').filter({ hasText: 'Check-in' });
  await expect(morning).toHaveAttribute('data-state', 'past');
  await expect(morning).toHaveCSS('background-color', 'rgb(241, 243, 244)');
  await expect(morning).toHaveCSS('color', 'rgb(95, 99, 104)');
  await expect(saturday.getByRole('listitem').filter({ hasText: 'Workshop: Google' })).toHaveAttribute('data-state', 'current');
  const marker = await line.evaluate(el => {
    const [rule, dot] = Array.from(el.children).map(child => child.getBoundingClientRect());
    // The time column is 44px on phones and 64px from lg (v0.11.21).
    return { rule: rule!.x, dot: dot!.x + dot!.width / 2, edge: el.getBoundingClientRect().x + parseFloat(getComputedStyle(el).getPropertyValue('--time-column')) };
  });
  expect(marker.rule).toBeCloseTo(marker.edge, 1);
  expect(marker.dot).toBeCloseTo(marker.edge, 1);
  if (process.env.AXIS_SCREENSHOTS) {
    mkdirSync(process.env.AXIS_SCREENSHOTS, { recursive: true });
    await page.mouse.move(0, 0);
    const style = 'nextjs-portal { visibility: hidden; }';
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: `${process.env.AXIS_SCREENSHOTS}/axis-style-desktop-full.png`, fullPage: true, style });
    await page.screenshot({ path: `${process.env.AXIS_SCREENSHOTS}/axis-style-desktop.png`, style });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${process.env.AXIS_SCREENSHOTS}/axis-style-phone.png`, fullPage: true, style });
    await line.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env.AXIS_SCREENSHOTS}/axis-style-phone-now.png`, style });
    await page.getByRole('button', { name: 'Sun Nov 8', exact: true }).click();
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${process.env.AXIS_SCREENSHOTS}/axis-style-phone-sunday.png`, style });
    await page.getByRole('button', { name: 'Sat Nov 7', exact: true }).click();
  }
  await page.clock.fastForward(60_000);
  await expect(line).toContainText('now 2:41 PM');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByText('Scroll across for overlapping events →')).toBeHidden();
});


test('T-ME-11: on a phone the Schedule fits the screen on the site\'s dark surface, compacts narrow cards, keeps text at the top and switches days', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-07T19:40:00Z') });
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, await emailOf(f.p.A), '/me/schedule');
  await expect(page.getByRole('heading', { name: 'SAT NOV 7' })).toBeVisible();
  await expect(page.getByTestId('schedule-now')).toContainText('now 2:40 PM');
  const saturday = page.getByRole('list', { name: 'Saturday, Nov 7', exact: true });
  await expect(saturday.getByRole('listitem')).toHaveCount(23);
  await expect(saturday.getByRole('listitem').filter({ hasText: 'Check-in' })).toHaveAttribute('data-state', 'past');
  await expect(page.getByRole('button', { name: 'Sat Nov 7', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const calendar = page.getByRole('region', { name: 'Sat Nov 7 calendar' });
  // v0.11.21: the poster columns fit a 390px phone instead of scrolling sideways.
  expect(await calendar.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(calendar).toHaveCSS('background-color', 'rgb(10, 16, 41)'); // the site's --surface, not the light poster panel
  // Each card's title sits at its top (a button centres its content by default): Sponsor Station's shows above Photo Booth.
  for (const name of ['Sponsor Station', 'Photo Booth']) {
    const card = (await saturday.getByRole('listitem').filter({ hasText: name }).boundingBox())!;
    const title = (await saturday.getByRole('listitem').filter({ hasText: name }).locator('strong').boundingBox())!;
    expect(title.y - card.y).toBeLessThan(12);
  }
  // Narrow cards drop the redundant "Workshop:" (workshops are yellow) and shorten the time.
  const google = saturday.getByRole('listitem').filter({ hasText: 'Google' }).locator('strong');
  await expect(google).toHaveText(/Workshop: Google/); // still in the accessible text
  expect(await google.innerText()).toBe('Google');
  await expect(saturday.getByRole('listitem').filter({ hasText: 'Google' })).toContainText('2:30–3:30 PM');
  const snacks = saturday.getByRole('listitem').filter({ hasText: 'Snack Cart' }).locator('strong');
  expect(await snacks.innerText()).toBe('Snack Cart'); // ", by Accenture" drops on a narrow card
  if (process.env.HOVER_SCREENSHOTS) await page.screenshot({ path: `${process.env.HOVER_SCREENSHOTS}/schedule-phone.png`, fullPage: true });
  await page.getByRole('button', { name: 'Sun Nov 8', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Sunday, Nov 8', exact: true }).getByRole('listitem')).toHaveCount(6);
  await expect(saturday).toBeHidden();
});


test('T-ME-10: profile tabs work without JavaScript, save only their fields, and route validation errors', async ({ page, browser }) => {
  const attendee = await f.addParticipant(f.e1.id);
  const email = await emailOf(attendee.id);
  await createAccount(email);
  await signIn(page, email, '/me/profile');
  const context = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: await page.context().storageState(), javaScriptEnabled: false });
  const profile = await context.newPage();
  const screenshots = '/tmp/claude-0/-home-yvesd-Codebases-datathon-Datathon-QR-NFC/7675cf3a-51e9-4cc4-b5e7-a411639544b0/scratchpad';
  mkdirSync(screenshots, { recursive: true });
  const stored = async () => (await f.pool.query(`select emergency_name, emergency_phone, emergency_relation, overnight, team_status, allergies, allergy_severity, accessibility, linkedin_url, discord_username, website_url, directory_opt_in, pace, bio, profile_public, dietary_notes from participants where id = $1`, [attendee.id])).rows[0];
  try {
    await profile.goto('/me/profile');
    const nav = profile.getByRole('navigation', { name: 'Profile sections' });
    await expect(nav.getByRole('link')).toHaveCount(3);
    expect(await nav.getByRole('link').evaluateAll(links => links.map(link => link.getAttribute('href')))).toEqual(
      ['/me/profile?tab=networking', '/me/profile?tab=event', '/me/profile?tab=health']);
    await expect(nav.getByRole('link', { name: 'The event · needs answer' })).toHaveAttribute('aria-current', 'page');
    await expect(profile.getByRole('heading', { name: 'Finish setting up your profile' })).toBeVisible();
    await expect(profile.getByLabel('LinkedIn (optional)')).toHaveCount(0);
    // The emergency contact has its own page: no fields here, only a link while it's missing.
    await expect(profile.getByLabel('Emergency contact name')).toHaveCount(0);
    await expect(profile.getByRole('link', { name: 'Add your emergency contact →' })).toHaveAttribute('href', '/me/emergency');
    let before = await stored();
    await profile.getByRole('radio', { name: 'Not sure yet', exact: true }).check();
    await profile.getByRole('radio', { name: 'I plan to go solo', exact: true }).check();
    await profile.getByRole('button', { name: 'Save profile' }).click();
    await expect(profile).toHaveURL(/tab=event&saved=1/);
    await expect(profile.getByRole('status')).toContainText('✓ Saved.');
    expect(await stored()).toEqual({ ...before, overnight: 'unsure', team_status: 'solo' });
    await expect(profile.getByRole('heading', { name: 'Hacker profile', exact: true })).toBeVisible();
    await expect(nav).not.toContainText('needs answer');
    await expect(profile.getByRole('link', { name: 'Add your emergency contact →' })).toBeVisible();
    await nav.getByRole('link', { name: 'Health and access', exact: true }).click();
    before = await stored();
    await profile.getByLabel('Allergies (optional)').fill('Peanuts');
    await profile.getByLabel('How severe?').selectOption('severe');
    await profile.getByLabel('Accessibility needs (optional)').fill('Step-free access');
    await profile.getByRole('button', { name: 'Save profile' }).click();
    await expect(profile).toHaveURL(/tab=health&saved=1/);
    expect(await stored()).toEqual({ ...before, allergies: 'Peanuts', allergy_severity: 'severe', accessibility: 'Step-free access' });
    await nav.getByRole('link', { name: 'Networking', exact: true }).click();
    before = await stored();
    await profile.getByLabel('Bio (optional)', { exact: true }).fill('Data and maps');
    await profile.getByLabel('Your pace (optional)').selectOption('balanced');
    await profile.getByRole('button', { name: 'Save links' }).click();
    await expect(profile).toHaveURL(/tab=networking&saved=1/);
    expect(await stored()).toEqual({ ...before, bio: 'Data and maps', pace: 'balanced' });
    for (const [width, height] of [[390, 844], [1280, 800]] as const) {
      await profile.setViewportSize({ width, height });
      for (const tab of ['event', 'health', 'networking']) {
        await nav.locator(`a[href="/me/profile?tab=${tab}"]`).click();
        await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('href', `/me/profile?tab=${tab}`);
        expect(await profile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        for (const link of await nav.getByRole('link').all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await nav.locator('[aria-current="page"]').scrollIntoViewIfNeeded();
        await profile.screenshot({ path: `${screenshots}/profile-tabs-${tab}-${width}.png`, fullPage: true });
      }
    }
    await profile.goto('/me/profile?tab=health');
    before = await stored();
    await profile.getByLabel('Allergies (optional)').fill('Shellfish');
    await profile.getByLabel('How severe?').selectOption('');
    await profile.locator('form').evaluate(form => { (form as HTMLFormElement).noValidate = true; });
    await profile.getByRole('button', { name: 'Save profile' }).click();
    await expect(profile).toHaveURL(/tab=health&error=INVALID_ALLERGY/);
    await expect(nav.getByRole('link', { name: 'Health and access', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(profile.getByRole('alert')).toContainText('Not saved. Pick how severe your allergy is');
    expect(await stored()).toEqual(before);
    for (const [width, height] of [[390, 844], [1280, 800]] as const) {
      await profile.setViewportSize({ width, height });
      await profile.screenshot({ path: `${screenshots}/profile-tabs-error-${width}.png`, fullPage: true });
    }
    await profile.goto('/me/profile?tab=networking&error=INVALID_ALLERGY');
    await expect(nav.getByRole('link', { name: 'Health and access', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(profile.getByRole('alert')).toContainText('Not saved. Pick how severe your allergy is');
  } finally { await context.close(); }
});

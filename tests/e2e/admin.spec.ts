import { expect, test } from '@playwright/test';
import { authStatePath, consoleMailText, E2E_ORIGIN, saveSignedInState } from '../fixtures/e2e';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC §11 organizer UI. Pages are gated server-side (403), and every number comes from /api/admin.
const ORG = authStatePath('admin-org');
const VOL = authStatePath('admin-vol');
const OTHER_ORG = authStatePath('admin-other-org');
const PAGES = ['', '/participants', '/teams', '/checkpoints', '/staff', '/info', '/export', '/tools'];

test.describe.configure({ mode: 'serial' });
test.use({ storageState: ORG });

let f: StandardFixture;
test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  f = await createStandardFixture();
  // vol3 becomes an organizer of E2 only: an organizer, but of the wrong event.
  await f.pool.query(`update event_staff set role = 'organizer' where event_id = $1 and user_id = $2`, [f.e2.id, f.staff.vol3]);
  await saveSignedInState(browser, f.staffEmail.org1, ORG);
  await saveSignedInState(browser, f.staffEmail.vol1, VOL);
  await saveSignedInState(browser, f.staffEmail.vol3, OTHER_ORG);
});
test.afterAll(async () => {
  await f.close();
});

test('T-ME-02: /me links staff to their events: Admin and Scanner for an organizer, Scanner only for a volunteer', async ({ page, browser }) => {
  await page.goto('/me');
  const staff = page.getByRole('region', { name: 'Staff' });
  await expect(staff.getByRole('link', { name: `Admin: ${f.e1.name}` })).toHaveAttribute('href', `/admin/${f.slug}`);
  await expect(staff.getByRole('link', { name: `Scanner: ${f.e1.name}` })).toHaveAttribute('href', `/scan/${f.slug}`);

  const context = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: VOL });
  const vol = await context.newPage();
  await vol.goto('/me');
  const volStaff = vol.getByRole('region', { name: 'Staff' });
  await expect(volStaff.getByRole('link', { name: `Scanner: ${f.e1.name}` })).toHaveAttribute('href', `/scan/${f.slug}`);
  await expect(volStaff.getByRole('link', { name: /^Admin/ })).toHaveCount(0);
  await context.close();
});

test('T-ME-02: /admin opens the newest event you organize; someone who organizes none goes to /me', async ({ page, browser }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(`/admin/${f.slug}`);
  for (const [state, to] of [
    [OTHER_ORG, `/admin/${f.slug}-2`],
    [VOL, '/me'],
  ] as const) {
    const context = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: state });
    const other = await context.newPage();
    await other.goto('/admin');
    await expect(other).toHaveURL(to);
    await context.close();
  }
});

test('T-ADM-01 (pages): a volunteer, and an organizer of another event, get 403 on every /admin page', async ({ browser }) => {
  for (const state of [VOL, OTHER_ORG]) {
    const context = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: state });
    for (const path of PAGES) {
      const res = await context.request.get(`/admin/${f.slug}${path}`, { maxRedirects: 0 });
      expect(res.status(), `${state} ${path}`).toBe(403);
      expect(await res.text()).not.toContain('Ada');
    }
    await context.close();
  }
});

test('T-ADM-01 (pages): signed out, /admin redirects to login with a way back', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto(`/admin/${f.slug}`);
  await expect(page).toHaveURL(`/login?next=${encodeURIComponent(`/admin/${f.slug}`)}`);
  await context.close();
});

test('T-ADM-01 (pages): the organizer gets 200 on every /admin page', async ({ request }) => {
  for (const path of PAGES) {
    const res = await request.get(`/admin/${f.slug}${path}`, { maxRedirects: 0 });
    expect(res.status(), path).toBe(200);
  }
});

test('T-ADM-06: door closed 20 min before starts_at shows a warning; opening the door clears it', async ({ page }) => {
  await f.pool.query(`update events set starts_at = now() + interval '20 minutes' where id = $1`, [f.e1.id]);
  await f.pool.query(`update checkpoints set is_open = false where id = $1`, [f.cp.D]);

  await page.goto(`/admin/${f.slug}`);
  const warning = page.getByRole('alert').filter({ hasText: 'door is closed' });
  await expect(warning).toBeVisible();
  await expect(page.getByTestId('kpi-accepted')).toHaveText(/Accepted\s*4/); // A, B, Rv, N (T is a test participant, §13)

  await page.goto(`/admin/${f.slug}/checkpoints`);
  const door = page.getByRole('row', { name: /Door/ });
  await expect(door.getByTestId('cp-state')).toHaveText('○ Closed');
  await door.getByRole('button', { name: 'Open Door' }).click();
  await expect(door.getByTestId('cp-state')).toHaveText('● Open');
  await expect(door.getByRole('button', { name: 'Close Door' })).toBeVisible();

  await page.goto(`/admin/${f.slug}`);
  await expect(page.getByTestId('kpi-accepted')).toBeVisible();
  await expect(warning).toHaveCount(0);
});

test('T-ADM-06: arrival bars keep UTC order across local days and expose hover/focus counts', async ({ page }) => {
  // Insert through the real scan path, then move fixture timestamps into two local days.
  await f.pool.query(`update events set starts_at = '2026-11-07T14:00:00Z', ends_at = '2026-11-09T04:00:00Z', timezone = 'America/Toronto' where id = $1`, [f.e1.id]);
  for (const [who, scannedAt] of [['A', '2026-11-08T02:20:00Z'], ['B', '2026-11-09T00:35:00Z'], ['N', '2026-11-09T00:40:00Z']] as const) {
    const result = await f.scan({ cp: f.cp.D, staff: f.staff.org1, token: f.token[who] });
    expect(result.code).toBe('ACCEPTED');
    await f.pool.query('update scans set scanned_at = $1 where id = $2', [scannedAt, result.scanId]);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/admin/${f.slug}`);
  const chart = page.getByRole('group', { name: /^Door arrivals per 15 minutes/ });
  const bars = chart.locator('[data-bucket-utc]');
  await expect(bars).toHaveCount(2);
  expect(await bars.evaluateAll(nodes => nodes.map(n => n.getAttribute('data-bucket-utc')))).toEqual(['2026-11-08T02:15:00.000Z', '2026-11-09T00:30:00.000Z']);
  await expect(chart).toContainText('Sat 9:15 PM');
  await expect(chart).toContainText('Sun 7:30 PM');
  const bar = bars.nth(1);
  await expect(bar).toHaveAccessibleName(/Sun 7:30 PM EST–7:45 PM EST · 2 arrivals/);
  await chart.scrollIntoViewIfNeeded();
  const before = await bar.boundingBox();
  await bar.hover();
  expect(await bar.boundingBox()).toEqual(before);
  const tooltip = page.getByTestId('hover-details');
  await expect(tooltip).toContainText('2 arrivals');
  await expect(tooltip).toContainText('Sun 7:30 PM EST–7:45 PM EST');
  if (process.env.HOVER_SCREENSHOTS) await page.screenshot({ path: `${process.env.HOVER_SCREENSHOTS}/hover-arrivals.png` });
  await page.mouse.move(0, 0);
  await expect(tooltip).toHaveCount(0);
  await bar.focus();
  await expect(tooltip).toContainText('2 arrivals');
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
  for (const [width, height] of [[1440, 900], [1920, 1080], [390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await expect(chart).toHaveCSS('height', '196px');
    await expect.poll(async () => {
      const plot = (await chart.boundingBox())!;
      const parent = (await chart.locator('..').boundingBox())!;
      return Math.abs(plot.width - parent.width);
    }).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const mark = chart.locator('path').last();
    const markBox = (await mark.boundingBox())!;
    expect(markBox.width).toBeLessThanOrEqual(32);
    await expect(chart.locator('text').last()).toHaveCSS('font-size', '11px');
    await chart.scrollIntoViewIfNeeded();
    await bar.hover();
    await expect(tooltip).toContainText('2 arrivals');
    if (process.env.HOVER_SCREENSHOTS && width !== 390) await page.screenshot({ path: `${process.env.HOVER_SCREENSHOTS}/hover-dashboard-${width}.png` });
    await page.mouse.move(0, 0);
  }
  await page.getByText('Show as table', { exact: true }).click();
  await expect(page.getByRole('row', { name: /Sun 7:30 PM EST–7:45 PM EST 2/ })).toBeVisible();
});

test('Admin smoke: walk-in with check-in shows as checked in; void a scan; exports are CSV', async ({ page }) => {
  await page.goto(`/admin/${f.slug}/participants`);
  await page.getByRole('button', { name: 'Add attendee' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('First name').fill('Wanda');
  await dialog.getByLabel('Last name').fill('Walkin');
  await dialog.getByLabel('Email', { exact: true }).fill(`wanda@${f.slug}.test`);
  await dialog.getByLabel('Check in now').check();
  await dialog.getByRole('button', { name: 'Add attendee' }).click();

  const row = page.getByRole('row', { name: /Wanda Walkin/ });
  await expect(row).toContainText('Checked in');

  await row.getByRole('button', { name: 'Details for Wanda Walkin' }).click();
  const details = page.getByRole('region', { name: 'Wanda Walkin' });
  await expect(details).toContainText('Door');
  await details.getByRole('button', { name: 'Void Door scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Test scan' }).click();
  await expect(details).toContainText('Voided');
  const { rows } = await f.pool.query(
    `select s.voided_at from scans s join participants p on p.id = s.participant_id where p.first_name = 'Wanda' and p.event_id = $1`,
    [f.e1.id],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].voided_at).not.toBeNull();

  await page.goto(`/admin/${f.slug}/export`);
  for (const name of ['Participants CSV', 'Scans CSV', 'Checkpoint summary CSV']) {
    const href = await page.getByRole('link', { name }).getAttribute('href');
    expect(href).toBeTruthy();
    const res = await page.request.get(href ?? '');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/csv');
  }
});

test('T-ADM-09: Add attendee with "Not RSVPed yet" adds a pending applicant; Send RSVP then emails them', async ({ page }) => {
  const email = `nora-${f.slug}@example.test`;
  await page.goto(`/admin/${f.slug}/participants`);
  await page.getByRole('button', { name: 'Add attendee' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('First name').fill('Nora');
  await dialog.getByLabel('Last name').fill('Notyet');
  await dialog.getByLabel('Email', { exact: true }).fill(email);
  await dialog.getByLabel('Not RSVPed yet').check();
  await expect(dialog.getByLabel('Check in now')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Add attendee' }).click();
  await expect(page.getByRole('status')).toContainText('Added Nora as not RSVPed yet');

  const row = page.getByRole('row', { name: /Nora Notyet/ });
  await expect(row).toContainText('pending');
  await expect(row).not.toContainText('RSVP sent');
  await page.getByLabel('Select Nora Notyet').check();
  await page.getByRole('button', { name: 'Send RSVP (1)' }).click();
  await expect(page.getByRole('status')).toHaveText('✓ RSVP emails queued for 1 person.');
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole('row', { name: /Nora Notyet/ })).toContainText('RSVP sent', { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  expect(await consoleMailText(email, '/rsvp#')).toMatch(/\/rsvp#[A-Za-z0-9_-]{32}/);

  // T-ADM-11 (v0.9.1): Revoke RSVP takes it back, e.g. after a test.
  const nora = page.getByRole('row', { name: /Nora Notyet/ });
  await nora.getByRole('button', { name: 'Revoke RSVP' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke RSVP' }).click();
  await expect(page.getByRole('status')).toHaveText('✓ RSVP revoked. They’re back to not RSVPed yet.');
  await expect(nora).not.toContainText('RSVP sent');
  await expect(nora.getByRole('button', { name: 'Revoke RSVP' })).toHaveCount(0);
});

test('T-ING-28: Tools → Import CSV previews the Sheet export, takes only Yes and Waitlist rows, then adds the new people as not RSVPed yet', async ({ page }) => {
  const id = (n: number) => `csv-${n}-${f.slug}`;
  // Like the organizers' Sheet: a STATUS column with Yes / Waitlist / Deny.
  const csv = [
    'STATUS,Timestamp,First Name,Last Name,Email Address,Applicant ID,Notes',
    `Yes,2026-10-01,Cora,"Csv, Jr",cora-${f.slug}@example.test,${id(1)},`,
    `Yes,2026-10-01,Cyrus,Csv,cyrus-${f.slug}@example.test,${id(2)},`,
    `Yes,2026-10-01,Nomail,Csv,,${id(3)},`,
    `Waitlist,2026-10-01,Celine,Csv,celine-${f.slug}@example.test,${id(4)},`,
    `Deny,2026-10-01,Dana,Csv,dana-${f.slug}@example.test,${id(5)},DENY - Under 18`,
  ].join('\r\n');
  await page.goto(`/admin/${f.slug}/participants`);
  await expect(page.getByRole('button', { name: 'Import CSV' })).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Tools', exact: true }).click();
  await expect(page).toHaveURL(`/admin/${f.slug}/tools`);
  const panel = page.getByRole('region', { name: 'Import CSV' });
  await expect(panel.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
  // v0.11.27: no Status choice; only Yes (Accepted) and Waitlist rows ever come in.
  await expect(panel.getByRole('checkbox')).toHaveCount(0);
  await panel.getByLabel('CSV file').setInputFiles({ name: 'applicants.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  const preview = panel.getByRole('status');
  await expect(preview).toContainText('5 rows in the file');
  await expect(preview).toContainText('3 new, added as not RSVPed yet');
  await expect(preview).toContainText('1 skipped: missing or invalid Applicant ID, email or name');
  await expect(preview).toContainText('1 skipped: Status isn’t Yes or Waitlist');
  // A dry run: nothing is written until Import.
  expect((await f.pool.query('select 1 from participants where external_id = $1', [id(1)])).rowCount).toBe(0);
  await panel.getByRole('button', { name: 'Import 3' }).click();
  await expect(panel.getByRole('status')).toContainText('✓ Imported 4 rows: 3 new, added as not RSVPed yet');
  await expect(panel.getByRole('status')).toContainText('1 skipped: Status isn’t Yes or Waitlist');
  expect((await f.pool.query('select 1 from participants where external_id = $1', [id(5)])).rowCount).toBe(0);
  await panel.getByRole('link', { name: 'Open Participants →' }).click();
  const cora = page.getByRole('row', { name: /Cora Csv, Jr/ });
  await expect(cora).toContainText('pending');
  await expect(cora).toContainText('Accepted');
  await expect(page.getByRole('row', { name: /Cyrus Csv/ })).not.toContainText('RSVP sent');
  await expect(page.getByRole('row', { name: /Celine Csv/ })).toContainText('Waitlisted');
  // The Sheet's decision is its own filter, apart from their status.
  await page.getByLabel('In the Sheet').selectOption('waitlisted');
  await expect(page.getByRole('row', { name: /Celine Csv/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Cora Csv, Jr/ })).toHaveCount(0);

  await page.goto(`/admin/${f.slug}/tools`);
  await panel.getByLabel('CSV file').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('Applicant ID,First Name,Status\r\nid-x,X,Accepted') });
  await expect(panel.getByRole('alert')).toHaveText('✕ Missing header: Email Address');
});

test('T-ADM-10: Checkpoints → People lists who was scanned there; Remove voids one, and they can be scanned again', async ({ page }) => {
  await f.scan({ cp: f.cp.R, staff: f.staff.vol1, token: f.token.A });
  await f.scan({ cp: f.cp.R, staff: f.staff.vol2, token: f.token.B });
  await page.goto(`/admin/${f.slug}/checkpoints`);
  await page.getByRole('button', { name: 'People at Raffle' }).click();
  const people = page.getByRole('region', { name: 'People at Raffle' });
  await expect(people.getByText('Ada Fixture')).toBeVisible();
  await expect(people.getByText('Ben Fixture')).toBeVisible();
  await expect(people).toContainText('2 people');
  await people.getByRole('button', { name: 'Remove Ada Fixture' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Test scan' }).click();
  // The confirmation names Ada too, so check the table rows.
  await expect(people.getByRole('status')).toContainText('Removed Ada Fixture');
  await expect(people.getByRole('row', { name: /Ada Fixture/ })).toHaveCount(0);
  await expect(people.getByRole('row', { name: /Ben Fixture/ })).toBeVisible();
  await expect(people).toContainText('1 person');
  expect((await f.scan({ cp: f.cp.R, staff: f.staff.vol1, token: f.token.A })).code).toBe('ACCEPTED');
});

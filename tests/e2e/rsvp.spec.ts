import { expect, test } from '@playwright/test';
import { consoleMailText, E2E_ORIGIN, signIn } from '../fixtures/e2e';
import { generateToken, sha256hex } from '@/lib/domain/token';
import { createAccount, createStandardFixture, STAFF_PASSWORD, type StandardFixture } from '../fixtures/standard';

// SPEC F13 + §6.1 (v0.4): organizer sends an RSVP → Yes (emergency contact, v0.6) + password → /me shows the pass.
let f: StandardFixture;
test.beforeEach(async () => {
  f = await createStandardFixture();
});
test.afterEach(async () => {
  await f.close();
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`invitation types once without moving the layout; reduced motion: ${reducedMotion}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    const name = 'Terminal invitation';
    await page.route('**/api/rsvp', (route) => route.fulfill({ json: {
      firstName: 'Rae', event: { name, venue: 'Hall', startsAt: '2026-11-01T12:00:00Z', timezone: 'America/Toronto' },
      status: 'pending', hasAccount: false, closed: false, closesAt: '2026-10-31T12:00:00Z',
    } }));
    await page.goto('/rsvp#typing-test');
    const heading = page.getByRole('heading', { name, exact: true });
    const animatedTitle = heading.locator('[aria-hidden="true"]');
    const greeting = page.getByText('Hi Rae, will you be there?', { exact: false }).first();
    await expect(heading).toBeVisible();
    const bounds = await greeting.boundingBox();
    await page.clock.runFor(200);
    await expect(page.getByRole('button', { name: 'Yes, I’m coming' })).toBeVisible();
    if (reducedMotion === 'reduce') {
      await expect(animatedTitle).toHaveCount(0);
    } else {
      await expect(animatedTitle).toContainText('Term');
      await expect(animatedTitle).not.toContainText(name);
      await page.clock.runFor(600);
      await expect(animatedTitle).toHaveText(name);
      await expect(page.locator('p > [aria-hidden="true"]')).toContainText('Hi Rae');
      await page.clock.runFor(1700);
      await expect(animatedTitle).toHaveCount(0);
    }
    expect(await greeting.boundingBox()).toEqual(bounds);
    await page.getByRole('button', { name: 'Yes, I’m coming' }).click();
    await page.clock.runFor(100);
    await expect(page.getByLabel('Set a password for your Datathon account')).toBeVisible();
    await expect(animatedTitle).toHaveCount(0);
    await expect(page.locator('p > [aria-hidden="true"]')).toHaveCount(0);
  });
}

test('T-RSVP-05: tick → Send RSVP → Yes with an emergency contact and a password → /me → the same pass as the email; tokens never in a URL', async ({ browser, page }) => {
  const email = `rae-${f.slug}@example.test`;
  await f.pool.query(
    `insert into participants (event_id, external_id, email, first_name, last_name, search_text, dietary_notes, status, source)
     values ($1, 'rsvp-1', $2, 'Rae', 'Rsvp', 'rae rsvp', 'Halal', 'pending', 'sheet')`,
    [f.e1.id, email],
  );

  await f.pool.query(`update events set rsvp_deadline = now() + interval '3 days' where id = $1`, [f.e1.id]); // v0.9
  await signIn(page, f.staffEmail.org1, `/admin/${f.slug}/participants`);
  await page.getByLabel('Select Rae Rsvp').check();
  await page.getByRole('button', { name: 'Send RSVP (1)' }).click();
  await expect(page.getByRole('status')).toHaveText('✓ RSVP emails queued for 1 person.');
  // The email goes out after the response; the list marks the row once it has been sent.
  await expect(async () => {
    await page.reload();
    await expect(page.getByText('RSVP sent')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });

  const invitation = await consoleMailText(email, '/rsvp#');
  expect(invitation).toContain('Please reply by '); // v0.9
  const rsvpToken = /\/rsvp#([A-Za-z0-9_-]{32})/.exec(invitation)?.[1] ?? '';
  expect(rsvpToken).toHaveLength(32);

  const attendee = await browser.newContext({ baseURL: E2E_ORIGIN });
  const p = await attendee.newPage();
  const urls: string[] = [];
  p.on('request', (r) => urls.push(r.url()));
  await p.goto(`/rsvp#${rsvpToken}`);
  await expect(p.getByRole('heading', { name: f.e1.name })).toBeVisible();
  await expect(p.getByText('Hi Rae, will you be there?')).toBeVisible();
  await expect(p.locator('strong', { hasText: /^\s*Reply by \w{3}, / })).toBeVisible();
  await expect(p.getByRole('button', { name: 'No, give my spot away' })).toBeVisible();
  await p.getByRole('button', { name: 'Yes, I’m coming' }).click();
  await expect(p.getByLabel('Dietary notes')).toHaveCount(0); // v0.8.2: the Sheet's, for organizers only
  await expect(p.getByLabel('Emergency contact name')).toHaveCount(0); // v0.9: set up after the Yes
  await p.getByLabel('Set a password for your Datathon account').fill('rae-event-password');
  await p.getByRole('button', { name: 'Yes, I’m coming' }).click();
  // Profile setup (F14) is offered after the Yes, not forced.
  await expect(p.getByRole('heading', { name: 'You’re in, Rae' })).toBeVisible();
  await p.getByRole('link', { name: 'Set up my hacker profile' }).click();
  await p.waitForURL('**/me/profile?setup=1');
  await expect(p.getByRole('navigation', { name: 'Profile sections' })).toHaveCount(0); // RSVP keeps the guided walkthrough.
  await expect(p.getByRole('heading', { name: 'Finish setting up your profile' })).toBeVisible();
  // The emergency contact has its own page: the profile links there while it's missing.
  await expect(p.getByLabel('Emergency contact name')).toHaveCount(0);
  await expect(p.getByText('Step 1 of 3: The event')).toBeVisible();
  await expect(p.getByRole('link', { name: 'Add your emergency contact →' })).toHaveAttribute('href', '/me/emergency');
  await p.getByRole('button', { name: 'Next', exact: true }).click();
  expect(await p.getByLabel('Not sure yet').evaluate((el) => (el as HTMLInputElement).validity.valueMissing)).toBe(true);
  await p.getByLabel('Not sure yet').check();
  await p.getByLabel('I’m looking for a team (lists my name in the Hacker directory)').check();
  await p.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(p.getByRole('heading', { name: 'Health and access', exact: true })).toBeFocused();
  await p.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(p.getByRole('heading', { name: 'The event', exact: true })).toBeFocused();
  await expect(p.getByLabel('Not sure yet')).toBeChecked();
  await p.getByRole('button', { name: 'Next', exact: true }).click();
  await p.getByLabel('Allergies (optional)').fill('Peanuts');
  // An allergy without its severity is caught in the browser: nothing is sent, so nothing typed is lost.
  await p.getByRole('button', { name: 'Save profile' }).click();
  expect(await p.getByLabel('How severe?').evaluate((el) => (el as HTMLSelectElement).validity.valueMissing)).toBe(true);
  await expect(p.getByLabel('Allergies (optional)')).toHaveValue('Peanuts');
  await p.getByLabel('How severe?').selectOption('severe');
  await p.getByLabel('Accessibility needs (optional)').fill('Step-free access');
  await p.getByRole('button', { name: 'Save profile' }).click();
  await expect(p.getByText('✓ Saved. Your profile is set up.')).toBeVisible();
  await expect(p.getByRole('heading', { name: 'Hacker profile' })).toBeVisible();
  await expect(p.getByText('Step 3 of 3: Networking (optional)')).toBeVisible();
  await expect(p.getByRole('heading', { name: 'Networking', exact: true })).toBeFocused();
  await p.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(p.getByRole('heading', { name: 'Health and access', exact: true })).toBeFocused();
  await p.getByRole('button', { name: 'Save profile', exact: true }).click();
  await p.getByRole('button', { name: 'Save links', exact: true }).click();
  await expect(p.getByText('✓ Saved.', { exact: true })).toBeVisible();
  await p.getByRole('link', { name: 'Add your emergency contact →' }).click();
  await p.waitForURL('**/me/emergency');
  await p.getByLabel('Name').fill('Sam Rsvp');
  await p.getByLabel('Phone').fill('416 555 0100');
  await p.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(p.getByText('✓ Saved.', { exact: true })).toBeVisible();
  await p.goto('/me/profile');
  await expect(p.getByRole('link', { name: 'Add your emergency contact →' })).toHaveCount(0);

  const { rows } = await f.pool.query(
    `select emergency_name, emergency_phone, looking_for_team, dietary_notes, overnight, team_status, allergies, allergy_severity, accessibility
       from participants where email = $1`,
    [email],
  );
  expect(rows).toEqual([
    {
      emergency_name: 'Sam Rsvp', emergency_phone: '416 555 0100', looking_for_team: true, dietary_notes: 'Halal',
      overnight: 'unsure', team_status: 'looking', allergies: 'Peanuts', allergy_severity: 'severe', accessibility: 'Step-free access',
    },
  ]);
  await p.goto('/me');
  await expect(p.getByRole('navigation', { name: 'Hacker menu' })).toBeVisible();

  // The pass email is sent after the response; /me shows the pass once it's issued.
  const passToken = /\/p#([A-Za-z0-9_-]{32})/.exec(await consoleMailText(email, '/p#'))?.[1] ?? '';
  await expect(async () => {
    await p.reload();
    await expect(p.getByRole('link', { name: 'My pass' })).toHaveAttribute('href', `/p#${passToken}`, { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await p.getByRole('link', { name: 'My pass' }).click();
  await expect(p.getByRole('img', { name: 'Your check-in QR code' })).toBeVisible();
  expect((await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: passToken })).code).toBe('ACCEPTED');

  // I-3: neither token ever went into a URL the server saw.
  expect(urls.filter((u) => u.includes(rsvpToken) || u.includes(passToken))).toEqual([]);

  // T-ME-01 (E): signed out, /me goes to sign-in; signing in with the new password comes back.
  await attendee.clearCookies();
  await p.goto('/me');
  await expect(p).toHaveURL(/\/login\?next=%2Fme/);
  await signIn(p, email, '/me', 'rae-event-password');
  await expect(p.getByRole('link', { name: 'My pass' })).toBeVisible();
  await attendee.close();
});

test('T-RSVP-04 (E): someone who already has an account types their own password on Yes; a wrong one is refused', async ({ browser }) => {
  const email = `ari-${f.slug}@example.test`;
  await createAccount(email);
  const token = generateToken();
  await f.pool.query(
    `insert into participants (event_id, external_id, email, first_name, last_name, search_text, status, source, rsvp_token_hash)
     values ($1, 'rsvp-acct', $2, 'Ari', 'Account', 'ari account', 'pending', 'sheet', $3)`,
    [f.e1.id, email, sha256hex(token)],
  );
  const attendee = await browser.newContext({ baseURL: E2E_ORIGIN });
  const p = await attendee.newPage();
  await p.goto(`/rsvp#${token}`);
  await p.getByRole('button', { name: 'Yes, I’m coming' }).click();
  await expect(p.getByLabel('Set a password for your Datathon account')).toHaveCount(0);
  await p.getByLabel('Your Datathon password').fill('not-my-password');
  await p.getByRole('button', { name: 'Yes, I’m coming' }).click();
  // Next's route announcer is also role=alert (empty), so pick ours by its text.
  await expect(p.getByRole('alert').filter({ hasText: 'isn’t your Datathon password' })).toBeVisible();
  expect((await f.pool.query('select status from participants where email = $1', [email])).rows).toEqual([{ status: 'pending' }]);
  await p.getByLabel('Your Datathon password').fill(STAFF_PASSWORD);
  await p.getByRole('button', { name: 'Yes, I’m coming' }).click();
  // Later skips profile setup for now; the menu still asks for it.
  await expect(p.getByRole('heading', { name: 'You’re in, Ari' })).toBeVisible();
  await p.getByRole('link', { name: 'Later' }).click();
  await p.waitForURL((u) => u.pathname === '/me');
  await expect(p.getByRole('navigation', { name: 'Hacker menu' }).getByText('Finish setting up')).toBeVisible();
  await attendee.close();
});

test('T-RSVP-04 (E): a volunteer without a display name who answers Yes goes through onboarding first (F9)', async ({ browser }) => {
  const email = `vic-${f.slug}@example.test`;
  const userId = await createAccount(email);
  await f.pool.query(`insert into event_staff (event_id, user_id, role) values ($1, $2, 'volunteer')`, [f.e1.id, userId]);
  const token = generateToken();
  await f.pool.query(
    `insert into participants (event_id, external_id, email, first_name, last_name, search_text, status, source, rsvp_token_hash)
     values ($1, 'rsvp-staff', $2, 'Vic', 'Volunteer', 'vic volunteer', 'pending', 'sheet', $3)`,
    [f.e1.id, email, sha256hex(token)],
  );
  const attendee = await browser.newContext({ baseURL: E2E_ORIGIN });
  const p = await attendee.newPage();
  await p.goto(`/rsvp#${token}`);
  await p.getByRole('button', { name: 'Yes, I’m coming' }).click();
  await p.getByLabel('Your Datathon password').fill(STAFF_PASSWORD);
  await p.getByRole('button', { name: 'Yes, I’m coming' }).click();
  await p.waitForURL((u) => u.pathname === '/onboarding' && u.searchParams.get('next') === '/me/profile');
  await attendee.close();
});

test('T-RSVP-08 (E): past the deadline the link says so and only offers to give the spot away', async ({ browser }) => {
  const { rows } = await f.pool.query<{ id: string }>(
    `insert into events (slug, name, venue, starts_at, ends_at, rsvp_deadline)
     values ($1, 'Late Fest', 'Hall', now() + interval '2 days', now() + interval '3 days', now() - interval '1 day') returning id`,
    [`${f.slug}-late`],
  );
  const token = generateToken();
  const email = `lou-${f.slug}@example.test`;
  await f.pool.query(
    `insert into participants (event_id, email, first_name, search_text, status, source, rsvp_token_hash, rsvp_sent_at)
     values ($1, $2, 'Lou', 'lou', 'pending', 'sheet', $3, now() - interval '10 days')`,
    [rows[0]?.id, email, sha256hex(token)],
  );
  const attendee = await browser.newContext({ baseURL: E2E_ORIGIN });
  const p = await attendee.newPage();
  await p.goto(`/rsvp#${token}`);
  await expect(p.getByText(/The RSVP deadline \(.+\) has passed/)).toBeVisible();
  await expect(p.getByRole('button', { name: 'Yes, I’m coming' })).toHaveCount(0);
  await p.getByRole('button', { name: 'No, give my spot away' }).click();
  await expect(p.getByRole('heading', { name: 'Thanks for letting us know' })).toBeVisible();
  expect((await f.pool.query('select status from participants where email = $1', [email])).rows).toEqual([{ status: 'withdrawn' }]);
  await attendee.close();
});

import { expect, test, type Browser } from '@playwright/test';
import { consoleMailText, E2E_ORIGIN, signIn } from '../fixtures/e2e';
import { createAccount, createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC F15 / §11 Teams (v0.7): organizers open forming and release tracks; hackers team up from their menu.
let f: StandardFixture;
test.describe.configure({ mode: 'serial' });
test.beforeEach(async () => {
  f = await createStandardFixture();
});
test.afterEach(async () => {
  await f.close();
});

const emailOf = async (participantId: string) =>
  (await f.pool.query<{ email: string }>('select email from participants where id = $1', [participantId])).rows[0]?.email ?? '';

async function hacker(browser: Browser, participantId: string) {
  const context = await browser.newContext({ baseURL: E2E_ORIGIN, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const email = await emailOf(participantId);
  await createAccount(email);
  await signIn(page, email, '/me');
  return { context, page };
}

test('T-TEAM-07: tracks and forming from the admin page; A creates a team, B joins with its code, A picks the released track', async ({ page, browser }) => {
  await signIn(page, f.staffEmail.org1, `/admin/${f.slug}/teams`);
  const tracks = await page.request.post(`/api/admin/${f.slug}/tracks`, {
    data: { text: 'Best AI/ML Project\nBest Hardware Project' },
  });
  expect(tracks.ok()).toBe(true);

  // Before forming opens, the Team page says so and offers nothing.
  const a = await hacker(browser, f.p.A);
  await a.page.getByRole('link', { name: /^Team\b/ }).click();
  await expect(a.page.getByText('Teams open on hackathon day.')).toBeVisible();
  await expect(a.page.getByRole('button', { name: 'Create team' })).toHaveCount(0);

  await page.getByLabel('Team forming open').check();
  await expect(page.getByText('✓ Team forming is open.')).toBeVisible();

  await a.page.reload();
  await a.page.getByLabel('Team name').fill('Data Wizards');
  await a.page.getByRole('button', { name: 'Create team' }).click();
  await expect(a.page.getByText('✓ Team created.')).toBeVisible();
  const code = (await a.page.getByText(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/).innerText()).replace('-', '');
  // Tracks exist but aren't released: the team learns when it can pick one.
  await expect(a.page.getByText('Your team picks its track once organizers open track picks.')).toBeVisible();
  await expect(a.page.getByText('Ada Fixture (you)')).toBeVisible();
  await a.page.getByRole('button', { name: 'Copy join code' }).click();
  await expect(a.page.getByRole('status').filter({ hasText: 'Join code copied.' })).toBeAttached();
  expect(await a.page.evaluate(() => navigator.clipboard.readText())).toBe(`${code.slice(0, 4)}-${code.slice(4)}`);

  // B mistypes the code first: it stays in the field with the error beside it.
  const b = await hacker(browser, f.p.B);
  await b.page.goto('/me/team');
  await b.page.getByLabel('Join code').fill('zzzz-zzzz');
  await b.page.getByRole('button', { name: 'Join team' }).click();
  await expect(b.page.getByLabel('Join code')).toHaveValue('zzzz-zzzz');
  await expect(b.page.getByLabel('Join code')).toHaveAccessibleDescription('✕ No team has that code. Check it and try again.');
  await expect(b.page.getByLabel('Join code')).toBeFocused();
  // Then types it in lowercase.
  await b.page.getByLabel('Join code').fill(code.toLowerCase());
  await b.page.getByRole('button', { name: 'Join team' }).click();
  await expect(b.page.getByText('✓ You joined the team.')).toBeVisible();
  await expect(b.page.getByRole('heading', { name: 'Data Wizards' })).toBeVisible();
  await expect(b.page.getByText('Ada Fixture')).toBeVisible();
  await expect(b.page.getByText('Ben Fixture (you)')).toBeVisible();

  await page.getByLabel('Tracks released').check();
  await expect(page.getByText('✓ Tracks released.')).toBeVisible();
  await a.page.reload();
  await a.page.getByLabel('Your team’s track').selectOption({ label: 'Best Hardware Project' });
  await a.page.getByRole('button', { name: 'Save track' }).click();
  await expect(a.page.getByText('✓ Track saved.')).toBeVisible();

  // The organizer sees the team, both members and the track.
  await page.reload();
  const team = page.getByRole('region', { name: 'Team Data Wizards' });
  await team.locator('summary').click();
  await expect(team.getByText('Ada Fixture')).toBeVisible();
  await expect(team.getByText('Ben Fixture')).toBeVisible();
  await expect(team.getByLabel('Track of Data Wizards')).toHaveValue(/.+/);
  await expect(team.getByLabel('Track of Data Wizards').locator('option:checked')).toHaveText('Best Hardware Project');
  await a.context.close();
  await b.context.close();
});


test('T-TEAM-07: N opts into the directory, A invites by email, N accepts and both see the team', async ({ browser }) => {
  await f.pool.query('update events set teams_open = true where id = $1', [f.e1.id]);
  const aContext = await browser.newContext({ baseURL: E2E_ORIGIN });
  const a = await aContext.newPage();
  await createAccount(await emailOf(f.p.A));
  await signIn(a, await emailOf(f.p.A), '/me/team');
  await a.getByLabel('Team name').fill('Data Wizards');
  await a.getByRole('button', { name: 'Create team' }).click();
  await expect(a.getByRole('heading', { name: 'Data Wizards' })).toBeVisible();
  const n = await hacker(browser, f.p.N);
  await n.page.goto('/me/team');
  await n.page.getByLabel('Looking for a team', { exact: true }).check();
  await n.page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(n.page.getByRole('status')).toContainText('✓ Saved. You’re listed under Looking for a team.');
  await n.page.getByRole('link', { name: 'Find teammates in the Hacker directory' }).click();
  await expect(n.page.getByText('Create a team to invite them.', { exact: false })).toBeVisible();
  const ownDirectory = n.page.getByRole('region', { name: 'Hacker directory' });
  // Listed by default since v0.11.19: her own card is marked (you), with no actions (F16).
  await expect(ownDirectory.getByRole('article', { name: 'Nia Fixture (you)' })).toBeVisible();
  await expect(ownDirectory.getByRole('button', { name: /Invite/ })).toHaveCount(0);
  await a.goto('/me/hackers?looking=1');
  const directory = a.getByRole('region', { name: 'Hacker directory' });
  await expect(directory.getByText('Nia Fixture')).toBeVisible();
  await expect(directory.getByText('Ada Fixture')).toHaveCount(0);
  await expect(directory.getByRole('button', { name: 'Invite Ada Fixture', exact: true })).toHaveCount(0);
  const nia = directory.getByRole('article', { name: 'Nia Fixture', exact: true });
  await expect(nia.getByRole('button', { name: 'Invite' })).toBeVisible(); // on the card without opening it
  await nia.getByRole('button', { name: 'Invite' }).click();
  await expect(a.getByRole('status')).toContainText('Invite sent');
  expect(await consoleMailText(await emailOf(f.p.N), '/me/team')).toContain(`${E2E_ORIGIN}/me/team`);
  await n.page.goto('/me/team');
  const invites = n.page.getByRole('region', { name: 'Pending invites' });
  await expect(invites).toContainText('Data Wizards');
  await expect(invites).toContainText('Ada');
  await invites.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(n.page.getByRole('heading', { name: 'Data Wizards' })).toBeVisible();
  await a.goto('/me/team');
  await expect(a.getByText('Nia Fixture')).toBeVisible();
  await aContext.close();
  await n.context.close();
});

test('T-TEAM-07 (v0.11.25): Leave team asks first in a dialog; Keep my team keeps it, Leave team leaves', async ({ browser }) => {
  await f.pool.query('update events set teams_open = true where id = $1', [f.e1.id]);
  const a = await hacker(browser, f.p.A);
  await a.page.goto('/me/team');
  await a.page.getByLabel('Team name').fill('Leave Me');
  await a.page.getByRole('button', { name: 'Create team' }).click();
  await a.page.getByRole('button', { name: 'Leave team' }).click();
  const dialog = a.page.getByRole('dialog', { name: 'Leave Leave Me?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('You’re its only member, so leaving deletes the team.');
  await dialog.getByRole('button', { name: 'Keep my team' }).click();
  await expect(dialog).toBeHidden();
  await expect(a.page.getByRole('button', { name: 'Leave team' })).toBeVisible();
  await a.page.getByRole('button', { name: 'Leave team' }).click();
  await dialog.getByRole('button', { name: 'Leave team' }).click();
  await expect(a.page.getByRole('button', { name: 'Create team' })).toBeVisible();
  await a.context.close();
});

test('T-TEAM-07: with forming closed, an invite says when it can be accepted and a team says how to leave', async ({ browser }) => {
  await f.pool.query('update events set teams_open = true where id = $1', [f.e1.id]);
  const a = await hacker(browser, f.p.A);
  await a.page.goto('/me/team');
  await a.page.getByLabel('Team name').fill('Closed Shop');
  await a.page.getByRole('button', { name: 'Create team' }).click();
  await expect(a.page.getByRole('heading', { name: 'Closed Shop' })).toBeVisible();
  await f.pool.query(
    `insert into team_invites (team_id, participant_id, event_id, invited_by)
     select team_id, $2, event_id, id from participants where id = $1`, [f.p.A, f.p.N]);
  await f.pool.query('update events set teams_open = false where id = $1', [f.e1.id]);

  await a.page.reload();
  await expect(a.page.getByText('Team changes are closed. Ask an organizer if you need to leave.')).toBeVisible();
  await expect(a.page.getByRole('button', { name: 'Leave team' })).toHaveCount(0);

  const n = await hacker(browser, f.p.N);
  await n.page.goto('/me/team');
  const invites = n.page.getByRole('region', { name: 'Pending invites' });
  await expect(invites).toContainText('Accepting opens when team forming opens.');
  await expect(invites.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0);
  await expect(invites.getByRole('button', { name: 'Decline' })).toBeVisible();
  await a.context.close();
  await n.context.close();
});

test('T-TEAM-08 (v0.11.25): a hacker picks the tracks they want under Looking, before release; others see and filter by them', async ({ browser }) => {
  await f.pool.query('update events set tracks_released = false where id = $1', [f.e1.id]);
  await f.pool.query(`insert into tracks (event_id, name) values ($1, 'Best AI'), ($1, 'Best Hardware')`, [f.e1.id]);
  const a = await hacker(browser, f.p.A);
  await a.page.goto('/me/team');
  await a.page.getByLabel('Looking for a team', { exact: true }).check();
  await a.page.getByRole('group', { name: 'Tracks I want to do' }).getByLabel('Best AI').check();
  await a.page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(a.page.getByText('✓ Saved. You’re listed under Looking for a team.')).toBeVisible();
  await expect(a.page.getByLabel('Best AI')).toBeChecked();
  await expect(a.page.getByLabel('Best Hardware')).not.toBeChecked();
  await a.context.close();

  const b = await hacker(browser, f.p.B);
  await b.page.goto('/me/hackers');
  await b.page.getByLabel('Track', { exact: true }).selectOption({ label: 'Best AI' });
  await expect(b.page).toHaveURL(/track=/);
  const directory = b.page.getByRole('region', { name: 'Hacker directory' });
  const ada = directory.getByRole('article', { name: 'Ada Fixture', exact: true });
  await expect(ada).toBeVisible();
  await expect(directory.getByRole('article')).toHaveCount(1);
  await ada.locator('summary').click();
  await expect(ada.locator('dt', { hasText: 'Wants to do' }).locator('xpath=following-sibling::dd[1]')).toHaveText('Best AI');
  await b.context.close();
});

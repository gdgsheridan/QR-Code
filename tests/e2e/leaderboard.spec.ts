import { expect, test } from '@playwright/test';
import { E2E_ORIGIN, signIn } from '../fixtures/e2e';
import { createAccount, createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC F17 step 6 (v0.12): the organizer's projector board, Freeze, and each hacker's rank on /me.
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
const mutual = (a: string, b: string) =>
  f.pool.query('insert into connection_taps (event_id, from_participant_id, to_participant_id) values ($1, $2, $3), ($1, $3, $2)', [f.e1.id, a, b]);

test('T-LB-04: the board shows "First L." and points, freezes as Final results, and A sees their rank on /me', async ({ browser }) => {
  await mutual(f.p.A, f.p.B);
  await mutual(f.p.A, f.p.N);

  const org = await browser.newContext({ baseURL: E2E_ORIGIN });
  const page = await org.newPage();
  await signIn(page, f.staffEmail.org1, `/admin/${f.slug}/leaderboard`);
  const board = page.getByRole('region', { name: 'Most connections' });
  await expect(board.getByRole('listitem').first()).toContainText('Ada F.');
  await expect(board.getByRole('listitem').first()).toContainText('2 connections');
  await expect(board.getByText('Live · tap badges and press Connect')).toHaveCount(0);
  await page.getByRole('button', { name: 'Freeze leaderboard' }).click();
  await page.getByRole('dialog', { name: 'Freeze the leaderboard?' }).getByRole('button', { name: 'Freeze leaderboard' }).click();
  await expect(board.getByRole('status')).toHaveText('Final results');
  await expect(board.getByText('Final results')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unfreeze' })).toBeVisible();
  await expect(board).not.toContainText('@'); // names only, never emails
  await org.close();

  const a = await browser.newContext({ baseURL: E2E_ORIGIN });
  const aPage = await a.newPage();
  await createAccount(await emailOf(f.p.A));
  await signIn(aPage, await emailOf(f.p.A), '/me');
  await expect(aPage.getByRole('link', { name: /^Connections/ })).toContainText('2 connections · #1 on the leaderboard');
  await aPage.goto('/me/connections');
  await expect(aPage.getByText('You’re #1 on the leaderboard.')).toBeVisible();
  await a.close();
});

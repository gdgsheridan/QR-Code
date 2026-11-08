import { expect, test } from '@playwright/test';
import { authStatePath, saveSignedInState } from '../fixtures/e2e';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// F17 / §11 Leaderboard (v0.12.4, owner's request and decision): Manage connections under the board.
const ORG = authStatePath('leaderboard-manage-org');
test.describe.configure({ mode: 'serial' });
test.use({ storageState: ORG });

let f: StandardFixture;
test.beforeAll(async ({ browser }) => {
  f = await createStandardFixture();
  await saveSignedInState(browser, f.staffEmail.org1, ORG);
});
test.afterAll(async () => {
  await f.close();
});

test('T-CONN-08: find a hacker on the Leaderboard tab, see their connections, remove one after confirming', async ({ page }) => {
  for (const [from, to] of [[f.p.A, f.p.B], [f.p.B, f.p.A], [f.p.N, f.p.A]] as const) {
    await f.pool.query('insert into connection_taps (event_id, from_participant_id, to_participant_id) values ($1, $2, $3)', [f.e1.id, from, to]);
  }
  await page.goto(`/admin/${f.slug}/leaderboard`);
  const panel = page.getByRole('region', { name: 'Manage connections' });
  await panel.getByLabel('Hacker').fill('Ada');
  await panel.getByRole('button', { name: 'Ada Fixture' }).click();
  const list = panel.getByRole('list', { name: 'Ada Fixture’s connections' });
  await expect(list.getByRole('listitem', { name: 'Ben Fixture' })).toContainText('● Connected');
  await expect(list.getByRole('listitem', { name: 'Nia Fixture' })).toContainText('↩ One-way: they tapped');

  await list.getByRole('button', { name: 'Remove Ada Fixture and Ben Fixture’s connection' }).click();
  const dialog = page.getByRole('dialog', { name: 'Remove this connection?' });
  await expect(dialog).toContainText('both lose the point');
  await dialog.getByRole('button', { name: 'Remove connection' }).click();
  await expect(panel.getByRole('status')).toHaveText('✓ Removed Ada Fixture ↔ Ben Fixture.');
  await expect(list.getByRole('listitem', { name: 'Ben Fixture' })).toHaveCount(0);
  await expect(list.getByRole('listitem', { name: 'Nia Fixture' })).toBeVisible();
  expect((await f.pool.query('select 1 from connection_taps where event_id = $1', [f.e1.id])).rows).toHaveLength(1);
});

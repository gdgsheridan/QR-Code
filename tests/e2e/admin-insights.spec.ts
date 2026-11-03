import { expect, test } from '@playwright/test';
import { E2E_ORIGIN, signIn } from '../fixtures/e2e';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC §13: the organizer's Workshops tab and the Leaderboard tab's connection stats.
let f: StandardFixture;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  f = await createStandardFixture();
});
test.afterAll(async () => {
  await f.close();
});

test('T-ANA-09: Workshops tab shows tiles, the per-workshop table, the breakdown and the chart; Leaderboard shows connection totals', async ({ browser }) => {
  const { rows } = await f.pool.query<{ id: string }>(
    `insert into checkpoints (event_id, name, kind, requires_checkin, is_open, capacity) values ($1, 'Intro to Pandas', 'session', true, true, 4) returning id`,
    [f.e1.id],
  );
  const pandas = rows[0]?.id ?? '';
  for (const p of [f.p.A, f.p.B]) {
    await f.checkIn(p);
    expect((await f.scan({ cp: pandas, staff: f.staff.vol1, participantId: p })).code).toBe('ACCEPTED');
  }
  await f.pool.query('insert into connection_taps (event_id, from_participant_id, to_participant_id) values ($1, $2, $3), ($1, $3, $2)', [f.e1.id, f.p.A, f.p.B]);

  const ctx = await browser.newContext({ baseURL: E2E_ORIGIN });
  const page = await ctx.newPage();
  await signIn(page, f.staffEmail.org1, `/admin/${f.slug}/workshops`);
  await expect(page.getByRole('heading', { name: 'Workshops', level: 1 })).toBeVisible();
  await expect(page.getByTestId('kpi-ws-attendees')).toContainText('2');
  await expect(page.getByTestId('kpi-ws-attendees')).toContainText('100% of checked-in hackers');
  await expect(page.getByRole('row', { name: /Intro to Pandas/ })).toContainText('50%');
  await expect(page.getByRole('list', { name: 'Checked-in hackers by number of workshops attended' }).getByRole('listitem').nth(1)).toContainText('2 (100%)');
  await expect(page.getByRole('group', { name: /Workshop check-ins per 15 minutes/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download workshop attendance CSV' })).toHaveAttribute('href', new RegExp(`/api/admin/${f.slug}/export/workshops\\.csv$`));

  // Who attended: the same People panel as the Checkpoints tab.
  await page.getByRole('button', { name: 'People at Intro to Pandas' }).click();
  const panel = page.getByRole('region', { name: 'People at Intro to Pandas' });
  await expect(panel.getByRole('row', { name: /Ada Fixture/ })).toBeVisible();
  await expect(panel.getByRole('row', { name: /Ben Fixture/ })).toBeVisible();
  await expect(panel.getByText('2 people')).toBeVisible();
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole('button', { name: 'People at Intro to Pandas' })).toBeFocused();

  // Phone width: no sideways page scroll (CLAUDE.md, accessibility).
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Leaderboard' }).click();
  await expect(page.getByTestId('kpi-conn-mutual')).toContainText('1');
  await expect(page.getByTestId('kpi-conn-people')).toContainText('100% of 2 checked in');
  await expect(page.getByRole('region', { name: 'Connection stats' })).not.toContainText('Fixture'); // totals only
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await ctx.close();
});

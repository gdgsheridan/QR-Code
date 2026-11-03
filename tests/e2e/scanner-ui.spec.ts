import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { authStatePath, chooseCheckpoint, fakeCameraArgs, saveSignedInState, signIn, warmDevServer } from '../fixtures/e2e';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// UI states driven by stubbed /api/scan responses (CLAUDE.md: route interception for UI-state tests).
// Scans are triggered through Manual search, so no QR video is needed; the fake camera still runs.
const AUTH = authStatePath('scanner-ui');
test.describe.configure({ mode: 'serial' });
test.use({ launchOptions: { args: fakeCameraArgs() }, permissions: ['camera'], storageState: AUTH });

let f: StandardFixture;
test.beforeAll(async ({ browser }) => {
  f = await createStandardFixture();
  await saveSignedInState(browser, f.staffEmail.vol1, AUTH);
  await warmDevServer(f.slug);
});
test.afterAll(async () => {
  await f.close();
});

const ada = { id: 'p-ada', displayName: 'Ada Fixture', status: 'accepted', dietaryNotes: null };

async function openScanner(page: Page, checkpoint = 'Door') {
  await page.goto(`/scan/${f.slug}`);
  await chooseCheckpoint(page, checkpoint);
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'ready');
}

async function recordAda(page: Page) {
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('ada');
  await page.getByRole('button', { name: 'Record scan for Ada Fixture' }).click();
}

async function stubScan(page: Page, body: Record<string, unknown>) {
  await page.unroute('**/api/scan');
  await page.route('**/api/scan', (route) => route.fulfill({ json: { serverTime: new Date().toISOString(), ...body } }));
}

test('T-SCUI-03: each ScanCode shows its §10.2 colour, icon, label and dismiss rule', async ({ page }) => {
  test.setTimeout(120_000);
  await openScanner(page);
  const cases: Array<[Record<string, unknown>, { tone: string; icon: string; text: string; dismiss: 'auto' | 'tap' }]> = [
    [{ code: 'ACCEPTED', replayed: false, scanId: randomUUID(), participant: ada }, { tone: 'green', icon: '✓', text: 'ADMIT', dismiss: 'auto' }],
    [{ code: 'ACCEPTED', replayed: true, scanId: randomUUID(), participant: ada }, { tone: 'green', icon: '✓', text: 'ADMIT (confirmed)', dismiss: 'auto' }],
    [{ code: 'ALREADY_SCANNED', participant: ada, previous: { scannedAt: new Date(Date.now() - 600_000).toISOString(), scannedByName: 'Maya', scannedByMe: false } }, { tone: 'red', icon: '✕', text: 'by Maya', dismiss: 'tap' }],
    [{ code: 'NOT_FOUND' }, { tone: 'red', icon: '✕', text: 'UNKNOWN CODE', dismiss: 'tap' }],
    [{ code: 'REVOKED', reissued: true, participant: ada }, { tone: 'amber', icon: '!', text: 'OLD CODE', dismiss: 'tap' }],
    [{ code: 'REVOKED', reissued: false, participant: ada }, { tone: 'red', icon: '✕', text: 'PASS CANCELLED', dismiss: 'tap' }],
    [{ code: 'NOT_ACCEPTED', participant: { ...ada, status: 'waitlisted' } }, { tone: 'red', icon: '✕', text: 'NOT ACCEPTED (waitlisted)', dismiss: 'tap' }],
    [{ code: 'WRONG_EVENT', otherEvent: 'Design Day' }, { tone: 'red', icon: '✕', text: 'This pass is for Design Day', dismiss: 'tap' }],
    [{ code: 'NOT_CHECKED_IN', participant: ada }, { tone: 'amber', icon: '!', text: 'Not checked in yet', dismiss: 'tap' }],
    [{ code: 'CHECKPOINT_CLOSED', participant: ada }, { tone: 'amber', icon: '!', text: 'Door is closed', dismiss: 'tap' }],
    [{ code: 'CAPACITY_REACHED', participant: ada, capacity: 40 }, { tone: 'red', icon: '✕', text: 'FULL (40)', dismiss: 'tap' }],
    [{ code: 'CLIENT_ID_CONFLICT' }, { tone: 'amber', icon: '!', text: 'Rescan please', dismiss: 'tap' }],
    [{ code: 'SESSION_COOLDOWN', participant: ada, availableAt: new Date(Date.now() + 245_000).toISOString(), cooldownMinutes: 5 }, { tone: 'amber', icon: '!', text: 'Next workshop in ', dismiss: 'tap' }],
    [{ code: 'FORBIDDEN' }, { tone: 'red', icon: '✕', text: 'No access', dismiss: 'tap' }],
  ];
  const result = page.getByTestId('scan-result');
  for (const [body, want] of cases) {
    await stubScan(page, body);
    await recordAda(page);
    await expect(result, String(body.code)).toHaveAttribute('data-tone', want.tone);
    await expect(result).toContainText(want.icon);
    await expect(result).toContainText(want.text);
    await expect(result).toHaveAttribute('data-dismiss', want.dismiss);
    if (want.dismiss === 'auto') {
      await expect(result).toBeHidden({ timeout: 4000 });
    } else {
      await result.click();
      await expect(result).toBeHidden();
      if (body.code === 'NOT_FOUND') {
        // "UNKNOWN CODE: use manual search" → tap → the search sheet opens (§10.2)
        await expect(page.getByRole('heading', { name: 'Manual search' })).toBeVisible();
        await page.getByRole('button', { name: 'Close' }).click();
      }
      if (body.code === 'FORBIDDEN') {
        // "No access" → tap → checkpoint picker (§10.2)
        await expect(page.getByRole('heading', { name: 'Choose your checkpoint' })).toBeVisible();
        await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
      }
    }
  }
});

test('T-SCUI-03: a problem result stays until tapped (no auto-dismiss)', async ({ page }) => {
  await openScanner(page);
  await stubScan(page, { code: 'NOT_FOUND' });
  await recordAda(page);
  await page.waitForTimeout(3500);
  await expect(page.getByTestId('scan-result')).toBeVisible();
});

test('T-SCUI-04: a hanging /api/scan is retried twice with the same clientScanId, then NO RESULT; never green', async ({ page }) => {
  await page.clock.install();
  const bodies: string[] = [];
  await page.route('**/api/scan', (route) => {
    bodies.push(route.request().postData() ?? '');
    // never answered
  });
  await openScanner(page);
  await recordAda(page);
  await expect.poll(() => bodies.length).toBe(1);
  await page.clock.runFor(8_100);
  await expect.poll(() => bodies.length).toBe(2);
  await page.clock.runFor(8_100);
  await expect.poll(() => bodies.length).toBe(3);
  await page.clock.runFor(8_100);
  const result = page.getByTestId('scan-result');
  await expect(result).toContainText('NO RESULT: do not admit yet. Rescan.');
  await expect(result).toHaveAttribute('data-tone', 'amber');
  const ids = bodies.map((b) => (JSON.parse(b) as { clientScanId: string }).clientScanId);
  expect(new Set(ids).size).toBe(1);
});

test('T-SCUI-05: offline shows the persistent banner and disables scanning and manual scan', async ({ page, context }) => {
  await openScanner(page);
  await context.setOffline(true);
  await expect(page.getByRole('alert').filter({ hasText: 'OFFLINE: use paper list' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Manual search' })).toBeDisabled();
  await expect(page.locator('main')).toHaveAttribute('data-scanning', 'paused');
  await context.setOffline(false);
  await expect(page.getByText('OFFLINE: use paper list')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Manual search' })).toBeEnabled();
});

test('T-SCUI-07: changing checkpoint asks for confirmation, updates the banner and survives a reload', async ({ page }) => {
  await openScanner(page, 'Door');
  await page.getByRole('button', { name: 'Change' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Lunch/ }).click();
  await expect(page.getByRole('heading', { name: 'Switch to Lunch?' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to Lunch' }).click();
  const banner = page.getByTestId('checkpoint-banner');
  await expect(banner).toContainText('Lunch');
  await expect(banner).toHaveAttribute('data-kind', 'meal');
  await page.reload();
  await expect(banner).toContainText('Lunch');
  await expect(page.getByRole('heading', { name: 'Choose your checkpoint' })).toBeHidden();
});

test('T-SCUI-09: "Undo last" is visible for 120 s after my accepted scan, then hidden', async ({ page }) => {
  await page.clock.install();
  await openScanner(page);
  await stubScan(page, { code: 'ACCEPTED', replayed: false, scanId: randomUUID(), participant: ada });
  await recordAda(page);
  await page.getByTestId('scan-result').click();
  const undo = page.getByRole('button', { name: 'Undo last' });
  await expect(undo).toBeVisible();
  await page.clock.runFor(118_000);
  await expect(undo).toBeVisible();
  await page.clock.runFor(4_000);
  await expect(undo).toBeHidden();
});

test('F11: undo with a quick-pick reason voids my real scan', async ({ page }) => {
  await openScanner(page, 'Raffle');
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('ben');
  await page.getByRole('button', { name: 'Record scan for Ben Fixture' }).click();
  await expect(page.getByTestId('scan-result')).toContainText('RECORDED');
  await page.getByTestId('scan-result').click();
  await page.getByRole('button', { name: 'Undo last' }).click();
  await page.getByRole('button', { name: 'Test scan' }).click();
  await expect(page.getByText('✓ Last scan undone.')).toBeVisible();
  const { rows } = await f.pool.query<{ void_reason: string }>(
    'select void_reason from scans where participant_id = $1 and checkpoint_id = $2',
    [f.p.B, f.cp.R],
  );
  expect(rows).toEqual([{ void_reason: 'Test scan' }]);
});

test('T-SCUI-10: an expired session mid-shift goes to login, then back to the same slug and checkpoint', async ({ page }) => {
  await openScanner(page, 'Lunch');
  await page.route('**/api/scan', (route) => route.fulfill({ status: 401, json: { error: 'unauthorized' } }));
  await recordAda(page);
  await page.waitForURL(`**/login?next=${encodeURIComponent(`/scan/${f.slug}`)}`);
  await page.unroute('**/api/scan');
  await signIn(page, f.staffEmail.vol1, `/scan/${f.slug}`);
  await expect(page.getByTestId('checkpoint-banner')).toContainText('Lunch');
});

test('T-SCUI-12: ALREADY_SCANNED by me 8 s ago is amber; by me 90 s ago and by vol2 are red', async ({ page }) => {
  await openScanner(page);
  const result = page.getByTestId('scan-result');
  const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString();
  const variants: Array<[Record<string, unknown>, string, RegExp]> = [
    [{ scannedAt: ago(8), scannedByName: 'Vol One', scannedByMe: true }, 'amber', /You scanned this \d+ s ago/],
    [{ scannedAt: ago(90), scannedByName: 'Vol One', scannedByMe: true }, 'red', /ALREADY SCANNED .* by Vol One/],
    [{ scannedAt: ago(8), scannedByName: 'Vol Two', scannedByMe: false }, 'red', /ALREADY SCANNED .* by Vol Two/],
  ];
  for (const [previous, tone, text] of variants) {
    await stubScan(page, { code: 'ALREADY_SCANNED', participant: ada, previous });
    await recordAda(page);
    await expect(result).toHaveAttribute('data-tone', tone);
    await expect(result).toContainText(text);
    await result.click();
  }
});

test('T-SRCH-07: manual search shows who already has a live scan at the selected checkpoint', async ({ page }) => {
  await f.checkIn(f.p.A, f.token.A);
  await openScanner(page, 'Door');
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('fixture');
  const ada = page.getByTestId('search-row').filter({ hasText: 'Ada Fixture' });
  const ben = page.getByTestId('search-row').filter({ hasText: 'Ben Fixture' });
  await expect(ada).toContainText('Already scanned here');
  await expect(ben).toBeVisible();
  await expect(ben).not.toContainText('Already scanned here');
  // Volunteers see masked emails (§10.4).
  await expect(ada).toContainText(/p\*\*\*@/);
});

test('T-SCUI-14: Scanned here lists who was scanned at this checkpoint; a volunteer can remove only their own fresh scan', async ({ page }) => {
  await f.scan({ cp: f.cp.R, staff: f.staff.vol1, token: f.token.N });
  await f.scan({ cp: f.cp.R, staff: f.staff.vol2, token: f.token.Rv });
  await openScanner(page, 'Raffle');
  await page.getByRole('button', { name: 'Scanned here' }).click();
  const list = page.getByRole('region', { name: 'Scanned here' });
  await expect(list.getByText('Nia Fixture')).toBeVisible();
  await expect(list.getByText('Rae Fixture')).toBeVisible();
  await expect(list.getByRole('button', { name: 'Remove Rae Fixture' })).toHaveCount(0); // vol2's scan
  await list.getByRole('button', { name: 'Remove Nia Fixture' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Test scan' }).click();
  // The confirmation names Nia too, so check the list items.
  await expect(list.getByRole('status')).toContainText('Removed Nia Fixture');
  await expect(list.getByRole('listitem').filter({ hasText: 'Nia Fixture' })).toHaveCount(0);
  await expect(list.getByRole('listitem').filter({ hasText: 'Rae Fixture' })).toBeVisible();
});


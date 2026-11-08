import { expect, test, type Page } from '@playwright/test';
import {
  authStatePath,
  chooseCheckpoint,
  fakeCameraArgs,
  forceGc,
  installFakeNfc,
  liveCameraTracks,
  nfcActive,
  nfcStartsWithCamera,
  nfcTap,
  nfcUnreadable,
  nfcWrites,
  saveSignedInState,
  serialOf,
  stubNfcPermission,
  trackCameraStreams,
  warmDevServer,
} from '../fixtures/e2e';
import { createStandardFixture, randomUid, type StandardFixture } from '../fixtures/standard';

// SPEC §10.5 / §14.15: badge scanning in the scanner, with a fake Web NFC reader (CLAUDE.md mock list).
const AUTH = authStatePath('scanner-nfc');
test.describe.configure({ mode: 'serial' });
test.use({ launchOptions: { args: [...fakeCameraArgs(), '--js-flags=--expose-gc'] }, permissions: ['camera'], storageState: AUTH });

let f: StandardFixture;
test.beforeAll(async ({ browser }) => {
  f = await createStandardFixture();
  await saveSignedInState(browser, f.staffEmail.vol1, AUTH);
  await warmDevServer(f.slug);
});
test.afterAll(async () => {
  await f.close();
});

async function openScanner(page: Page, checkpoint = 'Door') {
  await page.goto(`/scan/${f.slug}`);
  await chooseCheckpoint(page, checkpoint);
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'ready');
}

// v0.8.1: badges are their own input mode; the camera is off while the reader is on.
async function readerOn(page: Page) {
  await page.getByRole('button', { name: 'NFC badges' }).click();
  await expect(page.getByRole('button', { name: 'NFC badges' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Ready: tap a badge on the back of the phone')).toBeVisible();
}

// v0.12.2: a door ADMIT on a phone with Web NFC reads their badge itself and waits for it, so this taps one.
async function manualDoorScan(page: Page, query: string, name: string) {
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill(query);
  await page.getByRole('button', { name: `Record scan for ${name}` }).click();
  const result = page.getByTestId('scan-result');
  await expect(result).toContainText('ADMIT');
  await expect(result).toHaveAttribute('data-dismiss', 'link');
  await expect.poll(() => nfcActive(page)).toBe(1);
  const uid = randomUid();
  await nfcTap(page, serialOf(uid));
  await expect(result).toContainText(`✓ Badge ${serialOf(uid)} linked to ${name}.`);
  await expect(result).toBeHidden();
}

test('T-NFC-10: without Web NFC there are no badge controls at all', async ({ page }) => {
  await openScanner(page, 'Raffle'); // v0.12.1: Check-in itself needs Web NFC (T-NFC-29)
  await expect(page.getByRole('button', { name: /badge/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Camera', exact: true })).toHaveCount(0); // no input switch either
});

test('T-NFC-10: a linked badge scans through the real API; repeats, unreadable tags and offline taps send nothing', async ({ page, context }) => {
  await installFakeNfc(page);
  const { uid } = await f.linkBadge(f.p.A);
  const bodies: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/scan')) bodies.push(r.postData() ?? '');
  });
  await openScanner(page);
  await readerOn(page);

  const result = page.getByTestId('scan-result');
  await nfcTap(page, serialOf(uid));
  await expect(result).toHaveAttribute('data-tone', 'green');
  await expect(result).toContainText('ADMIT');
  await nfcTap(page, serialOf(uid)); // same badge again while the result is up
  await expect(result).toBeHidden({ timeout: 4000 });
  expect(bodies).toHaveLength(1);
  expect(JSON.parse(bodies[0] ?? '{}')).toMatchObject({ method: 'nfc', badgeUid: uid });

  await nfcTap(page, ''); // a tag that reports no UID
  await expect(result).toContainText('Not a Datathon code');
  await expect(result).toBeHidden({ timeout: 3000 });

  await context.setOffline(true);
  await expect(page.getByText('OFFLINE: use paper list')).toBeVisible();
  await nfcTap(page, serialOf(randomUid()));
  await expect(result).toBeHidden();
  await context.setOffline(false);
  expect(bodies).toHaveLength(1);
});

test('T-NFC-29: Manual search links a badge without scanning; a repeated tap is ignored until the dedupe window ends', async ({ page }) => {
  await installFakeNfc(page);
  await openScanner(page);
  await readerOn(page);
  const uid = randomUid();
  const scans: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/scan')) scans.push(r.postData() ?? '');
  });
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('ben');
  await page.getByRole('button', { name: 'Link badge for Ben Fixture', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Link a badge' });
  await expect(sheet).toContainText('Tap the badge to link it to Ben Fixture.');
  expect(await nfcActive(page)).toBe(1);
  const tappedAt = new Date();
  await page.clock.setFixedTime(tappedAt);
  const linked = page.waitForResponse(`**/api/events/${f.slug}/badges`);
  await nfcTap(page, serialOf(uid));
  expect((await linked).request().postDataJSON()).toEqual({ participantId: f.p.B, uid });
  await expect(sheet).toContainText(`✓ Badge ${serialOf(uid)} linked to Ben Fixture.`);
  expect(await nfcWrites(page)).toEqual([{ records: [{ recordType: 'url', data: `https://badges.example.test/profile/${uid}?tap` }] }]);
  await expect(sheet).toContainText('Its profile link is on the badge.');
  const badge = await f.pool.query<{ participant_id: string }>('select participant_id from badges where event_id = $1 and uid = $2', [f.e1.id, uid]);
  expect(badge.rows).toEqual([{ participant_id: f.p.B }]);
  const benScans = async () => (await f.pool.query('select id from scans where participant_id = $1', [f.p.B])).rows;
  expect(await benScans()).toEqual([]);
  await expect(page.getByTestId('scan-result')).toBeHidden();
  await nfcTap(page, serialOf(randomUid())); // the result stays in the sheet; another badge is not linked
  await expect(sheet).toContainText(`✓ Badge ${serialOf(uid)} linked to Ben Fixture.`);
  await sheet.getByRole('button', { name: 'Done' }).click();
  await nfcTap(page, serialOf(uid));
  await page.waitForTimeout(300); // allow an accidental scan request to reach the server
  expect(scans).toEqual([]);
  expect(await benScans()).toEqual([]);
  await expect(page.getByTestId('scan-result')).toBeHidden();
  await expect.poll(() => nfcActive(page)).toBe(1); // v0.12.2: a fresh reader after writing the badge
  await expect(page.getByRole('button', { name: 'NFC badges' })).toHaveAttribute('aria-pressed', 'true');

  await page.clock.setFixedTime(new Date(tappedAt.getTime() + 3001));
  await nfcTap(page, serialOf(uid));
  await expect(page.getByTestId('scan-result')).toContainText('ADMIT');
  await expect(page.getByTestId('scan-result')).toHaveAttribute('data-tone', 'green');
  expect(scans).toHaveLength(1);
  expect(await benScans()).toHaveLength(1);
  await page.getByTestId('scan-result').click();
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('ben');
  await expect(page.getByTestId('search-row')).toContainText('Badge linked');
  await expect(page.getByRole('button', { name: 'Replace badge for Ben Fixture' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record scan for Ben Fixture' })).toBeVisible();
});

// v0.11.40 tests use their own accepted hackers: this file's fixture is shared, and later tests expect Ben and Nia unlinked.
async function freshHacker(first: string) {
  const { id } = await f.addParticipant(f.e1.id);
  await f.pool.query(`update participants set first_name = $2, search_text = lower($2) || ' fixture' where id = $1`, [id, first]);
  return { id, name: `${first} Fixture`, query: first.toLowerCase() };
}

async function recordAtDoor(page: Page, who: { query: string; name: string }) {
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill(who.query);
  await page.getByRole('button', { name: `Record scan for ${who.name}` }).click();
  const result = page.getByTestId('scan-result');
  await expect(result).toContainText('ADMIT');
  await expect(result).toContainText(who.name);
  return result;
}

test('T-NFC-29: a door ADMIT reads their badge itself, camera off first; one badge tap finishes the check-in (v0.12.2)', async ({ page }) => {
  await installFakeNfc(page);
  await stubNfcPermission(page, 'granted');
  await trackCameraStreams(page);
  const lina = await freshHacker('Lina');
  await openScanner(page);
  const uid = randomUid();
  const linaScans = async () => (await f.pool.query('select id from scans where participant_id = $1', [lina.id])).rows;
  const result = await recordAtDoor(page, lina);
  await expect(result).toContainText('Hold their badge flat on the phone until it says linked');
  await expect(result).toHaveAttribute('data-dismiss', 'link');
  await expect(result.getByRole('button')).toHaveText(['Badge not reading? Reset badge reader']); // no Link badge, no Start badge reader: it is already reading (v0.12.4: Reset)
  await expect.poll(() => nfcActive(page)).toBe(1);
  expect(await nfcStartsWithCamera(page)).toEqual([0]); // A10: every camera track had ended before the reader started
  expect(await liveCameraTracks(page)).toBe(0);
  if (process.env.HOVER_SCREENSHOTS) { await page.waitForTimeout(600); await page.screenshot({ path: `${process.env.HOVER_SCREENSHOTS}/admit-reading.png` }); } // after the fade-in
  await result.click({ position: { x: 12, y: 12 } }); // a tap anywhere does nothing
  await page.waitForTimeout(3000); // past the 2.5 s a green result lasts elsewhere
  await expect(result).toContainText(lina.name);
  await expect(page.getByRole('dialog', { name: 'Link a badge' })).toHaveCount(0); // no sheet

  const linked = page.waitForResponse(`**/api/events/${f.slug}/badges`);
  await nfcTap(page, serialOf(uid));
  expect((await linked).request().postDataJSON()).toEqual({ participantId: lina.id, uid });
  await expect(result).toContainText(`✓ Badge ${serialOf(uid)} linked to ${lina.name}.`);
  if (process.env.HOVER_SCREENSHOTS) await page.screenshot({ path: `${process.env.HOVER_SCREENSHOTS}/admit-linked.png` });
  expect(await linaScans()).toHaveLength(1); // the check-in only; the linking tap is never a scan
  await expect(result).toBeHidden({ timeout: 2500 }); // clears by itself after 1.5 s
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'ready'); // Camera mode is back
  expect(await nfcActive(page)).toBe(0);
});

test('T-NFC-29: a refused link stays on the waiting ADMIT; that badge can be tapped again, and the next badge links it (v0.12.2)', async ({ page }) => {
  await installFakeNfc(page);
  await stubNfcPermission(page, 'granted');
  const pia = await freshHacker('Pia');
  await openScanner(page);
  const result = await recordAtDoor(page, pia);
  await expect.poll(() => nfcActive(page)).toBe(1);
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/badges')) posts.push(r.postData() ?? '');
  });
  await page.route('**/api/events/*/badges', (route) => route.fulfill({ json: { code: 'BADGE_TAKEN' } }));
  const taken = randomUid();
  const status = result.getByTestId('admit-link-status');
  await nfcTap(page, serialOf(taken));
  await expect(status).toHaveText(`✕ Badge ${serialOf(taken)} is linked to someone else. Ask an organizer to move it.`);
  expect(posts).toHaveLength(1);
  if (process.env.HOVER_SCREENSHOTS) { await page.waitForTimeout(600); await page.screenshot({ path: `${process.env.HOVER_SCREENSHOTS}/admit-taken.png` }); } // after the fade-in
  await expect(result).toHaveAttribute('data-dismiss', 'link'); // still waiting
  const ready = 'Hold their badge flat on the phone until it says linked'; // the reader is back after writing that badge (v0.12.2)
  await expect(result).toContainText(ready);
  await nfcTap(page, serialOf(taken)); // the same badge again: asked again, not ignored
  await expect.poll(() => posts.length).toBe(2);
  await expect(status).toHaveText(`✕ Badge ${serialOf(taken)} is linked to someone else. Ask an organizer to move it.`);
  await page.unroute('**/api/events/*/badges');
  await expect(result).toContainText(ready);
  const uid = randomUid();
  await nfcTap(page, serialOf(uid));
  await expect(result).toContainText(`✓ Badge ${serialOf(uid)} linked to ${pia.name}.`);
  await result.click(); // a tap skips the confirmation
  await expect(result).toBeHidden({ timeout: 500 });
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'ready');
});

test('T-NFC-29: a badge pulled away before its profile link is written is asked for again on the ADMIT, then the check-in finishes anyway (v0.12.4)', async ({ page }) => {
  await installFakeNfc(page, 'fail');
  await stubNfcPermission(page, 'granted');
  const kit = await freshHacker('Kit');
  await openScanner(page);
  const result = await recordAtDoor(page, kit);
  const status = result.getByTestId('admit-link-status');
  const ready = 'Hold their badge flat on the phone until it says linked';
  await expect(result).toContainText(ready);
  const uid = randomUid();
  for (const attempt of [1, 2]) {
    await nfcTap(page, serialOf(uid));
    await expect(status).toContainText("Its profile link didn't write (NotAllowedError after ");
    await expect(status).toContainText('Hold the same badge flat on the phone until it says linked.');
    await expect(result).toHaveAttribute('data-dismiss', 'link'); // still waiting for the same badge
    expect(await nfcWrites(page)).toHaveLength(attempt);
    await expect(result).toContainText(ready, { timeout: 6000 }); // the reader restarted after the write
  }
  await nfcTap(page, serialOf(uid)); // third time: linked without its profile link, and the volunteer has to see that
  await expect(result).toContainText(`✓ Badge ${serialOf(uid)} linked to ${kit.name}, but its profile link didn't write`);
  await page.waitForTimeout(2000);
  await expect(result).toBeVisible(); // no 1.5 s auto-dismiss
  const linked = await f.pool.query('select participant_id from badges where uid = $1', [uid]);
  expect(linked.rows).toEqual([{ participant_id: kit.id }]);
  await result.click();
  await expect(result).toBeHidden();
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'ready');
});

test('T-NFC-29: a badge already written by the old nfc.yvesdonato.com app is not written again (v0.12.4)', async ({ page }) => {
  await installFakeNfc(page);
  await stubNfcPermission(page, 'granted');
  const uma = await freshHacker('Uma');
  await openScanner(page);
  const result = await recordAtDoor(page, uma);
  await expect(result).toContainText('Hold their badge flat on the phone until it says linked');
  const uid = randomUid();
  await nfcTap(page, serialOf(uid), [`https://nfc.yvesdonato.com/profile/${uid}?tap`]);
  await expect(result).toContainText(`✓ Badge ${serialOf(uid)} linked to ${uma.name}.`);
  expect(await nfcWrites(page)).toHaveLength(0);
});

test('T-NFC-29: Reset badge reader on a waiting ADMIT stops the reader and starts a fresh one, then a tap links (v0.12.4)', async ({ page }) => {
  await installFakeNfc(page);
  await stubNfcPermission(page, 'granted');
  const ola = await freshHacker('Ola');
  await openScanner(page);
  const result = await recordAtDoor(page, ola);
  await expect.poll(() => nfcActive(page)).toBe(1);
  await result.getByRole('button', { name: 'Badge not reading? Reset badge reader' }).click();
  await expect(result).toContainText('Starting badge reader…');
  expect(await nfcActive(page)).toBe(0);
  await expect(result).toContainText('Hold their badge flat on the phone until it says linked', { timeout: 6000 });
  expect(await nfcActive(page)).toBe(1);
  await expect(result).toHaveAttribute('data-dismiss', 'link');
  const uid = randomUid();
  await nfcTap(page, serialOf(uid));
  await expect(result).toContainText(`✓ Badge ${serialOf(uid)} linked to ${ola.name}.`);
});

test('T-NFC-29: the first check-in on a phone asks for one Start badge reader tap, then a badge tap links (v0.12.2)', async ({ page }) => {
  await installFakeNfc(page);
  await stubNfcPermission(page, 'prompt');
  const ivy = await freshHacker('Ivy');
  await openScanner(page);
  const result = await recordAtDoor(page, ivy);
  const start = result.getByRole('button', { name: 'Start badge reader' });
  await expect(start).toBeVisible();
  await expect(result).toContainText('Tap Start badge reader, then their badge');
  if (process.env.HOVER_SCREENSHOTS) { await page.waitForTimeout(600); await page.screenshot({ path: `${process.env.HOVER_SCREENSHOTS}/admit-start-reader.png` }); }
  expect(await nfcActive(page)).toBe(0); // Chrome needs this tap before it can ask for NFC
  await start.click();
  await expect(start).toHaveCount(0);
  await expect.poll(() => nfcActive(page)).toBe(1);
  const uid = randomUid();
  await nfcTap(page, serialOf(uid));
  await expect(result).toContainText(`✓ Badge ${serialOf(uid)} linked to ${ivy.name}.`);
  await expect(result).toBeHidden({ timeout: 2500 });
});

test('T-NFC-29: the Link badge button opens a link-only search; Replace badge moves them to a new badge (v0.11.40)', async ({ page }) => {
  await installFakeNfc(page);
  const omar = await freshHacker('Omar');
  await openScanner(page);
  const [first, second] = [randomUid(), randomUid()];
  const scans: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/scan')) scans.push(r.postData() ?? '');
  });
  const linkOne = async (action: 'Link' | 'Replace', uid: string) => {
    await page.getByRole('button', { name: 'Link badge', exact: true }).click();
    const search = page.getByRole('region', { name: 'Link a badge' });
    await expect(search).toContainText('Find the hacker, then tap Link badge or Replace badge.');
    await search.getByPlaceholder('Type a name').fill(omar.query);
    await expect(search.getByRole('button', { name: `${action} badge for ${omar.name}` })).toBeVisible();
    await expect(search.getByRole('button', { name: /Record scan/ })).toHaveCount(0);
    if (action === 'Replace' && process.env.HOVER_SCREENSHOTS) await page.screenshot({ path: `${process.env.HOVER_SCREENSHOTS}/link-only-search.png` });
    await search.getByRole('button', { name: `${action} badge for ${omar.name}` }).click();
    const sheet = page.getByRole('dialog', { name: 'Link a badge' });
    await expect.poll(() => nfcActive(page)).toBe(1); // v0.12.4: the reader starts 0.8 s after the camera closes
    await nfcTap(page, serialOf(uid));
    await expect(sheet).toContainText(`✓ Badge ${serialOf(uid)} linked to ${omar.name}.`);
    await sheet.getByRole('button', { name: 'Done' }).click();
  };
  await linkOne('Link', first);
  await linkOne('Replace', second);
  const badges = await f.pool.query<{ uid: string }>('select uid from badges where event_id = $1 and participant_id = $2', [f.e1.id, omar.id]);
  expect(badges.rows).toEqual([{ uid: second }]); // the old badge no longer opens or scans anyone
  expect(scans).toEqual([]);
});

test('T-NFC-29: without Web NFC, Check-in can’t be picked or restored; other checkpoints can (v0.12.1)', async ({ page }) => {
  await page.goto(`/scan/${f.slug}`);
  const door = page.getByRole('dialog').getByRole('button', { name: /Door/ });
  await expect(door).toBeDisabled();
  await expect(door).toContainText('Check-in needs an Android phone with NFC (Chrome).');
  await chooseCheckpoint(page, 'Raffle');
  await page.evaluate(([key, id]) => localStorage.setItem(key, id), [`station:checkpoint:${f.slug}`, f.cp.D] as const);
  await page.reload(); // a Check-in saved on this device isn't restored either
  await expect(page.getByRole('heading', { name: 'Choose your checkpoint' })).toBeVisible();
  await expect(page.getByTestId('checkpoint-banner')).toContainText('No checkpoint selected');
});

test('T-NFC-29: a taken badge shows a red notice in the link sheet and never a scan result', async ({ page }) => {
  await installFakeNfc(page);
  await page.route('**/api/events/*/badges', (route) => route.fulfill({ json: { code: 'BADGE_TAKEN' } }));
  await openScanner(page);
  await readerOn(page);
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('nia');
  await page.getByRole('button', { name: 'Link badge for Nia Fixture', exact: true }).click();
  const uid = randomUid();
  await nfcTap(page, serialOf(uid));
  const sheet = page.getByRole('dialog', { name: 'Link a badge' });
  const notice = sheet.getByText(`✕ Badge ${serialOf(uid)} is linked to someone else. Ask an organizer to move it.`);
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute('data-tone', 'bad');
  await expect(notice).toHaveCSS('color', 'rgb(248, 113, 113)');
  await expect(page.getByTestId('scan-result')).toBeHidden();
  await expect(sheet.getByRole('button', { name: 'Done' })).toBeVisible();
});

test('T-NFC-29: linking temporarily releases the camera and reuses one reader; Cancel restores Camera mode', async ({ page }) => {
  await installFakeNfc(page);
  await trackCameraStreams(page);
  await openScanner(page);
  expect(await liveCameraTracks(page)).toBe(1);
  expect(await nfcActive(page)).toBe(0);
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('nia');
  await page.getByRole('button', { name: 'Link badge for Nia Fixture', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Link a badge' });
  await expect(sheet).toBeVisible();
  await expect.poll(() => liveCameraTracks(page)).toBe(0);
  await expect.poll(() => nfcActive(page)).toBe(1);
  await expect(page.locator('main')).toHaveAttribute('data-scanning', 'paused');
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'ready');
  expect(await liveCameraTracks(page)).toBe(1);
  expect(await nfcActive(page)).toBe(0);
  await expect(page.getByRole('button', { name: 'Camera', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Camera', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'ready');
});

test('T-NFC-29: unreadable tags keep waiting and repeated taps during a link send only one request', async ({ page }) => {
  await installFakeNfc(page);
  let release: () => void = () => undefined;
  const answer = new Promise<void>((r) => (release = r));
  const links: string[] = [];
  const scans: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/scan')) scans.push(r.url());
  });
  await page.route('**/api/events/*/badges', async (route) => {
    links.push(route.request().postData() ?? '');
    await answer;
    await route.fulfill({ json: { code: 'NOT_FOUND' } });
  });
  await openScanner(page);
  await readerOn(page);
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('nia');
  await page.getByRole('button', { name: 'Link badge for Nia Fixture', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Link a badge' });
  await nfcUnreadable(page);
  await expect(sheet).toContainText('Couldn’t read that badge. Hold it still and tap again.');
  await nfcTap(page, '');
  await expect(sheet).toContainText('Couldn’t read that badge. Hold it still and tap again.');
  expect(links).toEqual([]);
  await expect(sheet.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await nfcTap(page, serialOf(randomUid()));
  await expect.poll(() => links.length).toBe(1);
  await nfcTap(page, serialOf(randomUid()));
  await nfcUnreadable(page);
  release();
  await expect(sheet).toContainText('✕ Nia Fixture isn’t in this event any more.');
  expect(links).toHaveLength(1);
  expect(scans).toEqual([]);
  await expect(page.getByTestId('scan-result')).toBeHidden();
});

test('T-NFC-29: a failed link request stays in the sheet without a scan result', async ({ page }) => {
  await installFakeNfc(page);
  await page.route('**/api/events/*/badges', (route) => route.abort('failed'));
  await openScanner(page);
  await readerOn(page);
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('nia');
  await page.getByRole('button', { name: 'Link badge for Nia Fixture', exact: true }).click();
  await nfcTap(page, serialOf(randomUid()));
  const sheet = page.getByRole('dialog', { name: 'Link a badge' });
  await expect(sheet).toContainText('✕ Badge not linked. Try again.');
  await expect(sheet.getByRole('button', { name: 'Done' })).toBeVisible();
  await expect(page.getByTestId('scan-result')).toBeHidden();
});

test('T-NFC-29: another badge tapped while a link is saving is not scanned by a repeated report after Done', async ({ page }) => {
  await installFakeNfc(page);
  const { id } = await f.addParticipant(f.e1.id);
  const { uid: other } = await f.linkBadge(id); // a working badge: a stray scan of it would be ACCEPTED
  let release: () => void = () => undefined;
  const answer = new Promise<void>((r) => (release = r));
  const scans: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/scan')) scans.push(r.url());
  });
  await page.route('**/api/events/*/badges', async (route) => {
    await answer;
    await route.fulfill({ json: { code: 'LINKED' } });
  });
  await openScanner(page);
  await readerOn(page);
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('nia');
  await page.getByRole('button', { name: 'Link badge for Nia Fixture', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Link a badge' });
  await nfcTap(page, serialOf(randomUid()));
  await expect(sheet).toContainText('Linking badge…');
  await nfcTap(page, serialOf(other)); // ignored while saving
  release();
  await sheet.getByRole('button', { name: 'Done' }).click();
  await nfcTap(page, serialOf(other)); // Android reporting that tap again, within 3 s
  await expect(sheet).toBeHidden();
  await page.waitForTimeout(300); // a scan would be sent at once
  expect(scans).toEqual([]);
  await expect(page.getByTestId('scan-result')).toBeHidden();
});

test('T-NFC-29: closing the link sheet while the link is saving resumes scanning and still reports the outcome', async ({ page }) => {
  await installFakeNfc(page);
  let release: () => void = () => undefined;
  const answer = new Promise<void>((r) => (release = r));
  await page.route('**/api/events/*/badges', async (route) => {
    await answer;
    await route.fulfill({ json: { code: 'LINKED' } });
  });
  await openScanner(page);
  await readerOn(page);
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('nia');
  await page.getByRole('button', { name: 'Link badge for Nia Fixture', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Link a badge' });
  const uid = randomUid();
  await nfcTap(page, serialOf(uid));
  await expect(sheet).toContainText('Linking badge…');
  // Chrome closes a <dialog> on a second Back/Escape even if the page refuses the first: never strand the scanner.
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(page.locator('main')).toHaveAttribute('data-scanning', 'on');
  release();
  await expect(page.getByRole('status')).toContainText(`✓ Badge ${serialOf(uid)} linked to Nia Fixture.`);
  // A later link opens a fresh sheet.
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('nia');
  await page.getByRole('button', { name: /badge for Nia Fixture/ }).click();
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Tap the badge to link it to Nia Fixture.');
  await expect(sheet).not.toContainText('Linking badge…');
  const next = randomUid();
  await nfcTap(page, serialOf(next));
  await expect(sheet).toContainText(`✓ Badge ${serialOf(next)} linked to Nia Fixture.`);
});

test('T-NFC-29: waitlisted participants have no Link badge action', async ({ page }) => {
  await installFakeNfc(page);
  await openScanner(page);
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('cy');
  const row = page.getByTestId('search-row');
  await expect(row).toContainText('Cy Fixture');
  await expect(row).toContainText('waitlisted');
  await expect(row.getByRole('button', { name: /(?:Link|Replace) badge/ })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Record scan for Cy Fixture' })).toBeVisible();
});

test('T-NFC-29: Manual search has no Link badge action without Web NFC', async ({ page }) => {
  await openScanner(page, 'Raffle'); // v0.12.1: Check-in itself needs Web NFC
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('nia');
  const row = page.getByTestId('search-row');
  await expect(row).toContainText('Nia Fixture');
  await expect(row.getByRole('button', { name: /(?:Link|Replace) badge/ })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Record scan for Nia Fixture' })).toBeVisible();
});

test('T-NFC-29: the undo ticker does not refetch Manual search or remount its buttons', async ({ page }) => {
  await installFakeNfc(page);
  const tia = await freshHacker('Tia'); // the check-in links a badge, and later tests expect Nia unlinked
  await openScanner(page);
  await readerOn(page);
  await manualDoorScan(page, tia.query, tia.name);
  await expect(page.getByRole('button', { name: 'Undo last' })).toBeVisible();
  const searches: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/participants/search?')) searches.push(r.url());
  });
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('nia');
  const link = page.getByRole('button', { name: 'Link badge for Nia Fixture', exact: true });
  await expect(link).toBeVisible();
  await link.focus();
  await page.waitForTimeout(2200); // two undo ticks must leave the search row and its focus alone
  expect(searches).toHaveLength(1);
  await expect(link).toBeFocused();
});

test('T-NFC-10: a badge read vibrates at once, before the answer; until the page is tapped, the scanner says to tap once', async ({ page }) => {
  await installFakeNfc(page);
  await page.addInitScript(() => {
    const w = window as unknown as { __vibrations: unknown[] };
    w.__vibrations = [];
    // Playwright's own locator checks count as user activation, so fake Chrome's sticky activation: only a click sets it.
    let tapped = false;
    for (const e of ['click', 'keydown']) window.addEventListener(e, () => (tapped = true), true);
    Object.defineProperty(navigator, 'userActivation', { value: { get hasBeenActive() { return tapped; }, get isActive() { return tapped; } } });
    Object.defineProperty(navigator, 'vibrate', {
      value: (pattern: unknown) => {
        w.__vibrations.push(pattern);
        return true;
      },
    });
  });
  const vibrations = () => page.evaluate(() => (window as unknown as { __vibrations: unknown[] }).__vibrations);
  const { uid } = await f.linkBadge(f.p.A);
  let release: () => void = () => undefined;
  const answer = new Promise<void>((r) => (release = r));
  await page.route('**/api/scan', async (route) => {
    await answer; // hold the server's answer back
    await route.continue();
  });

  await page.goto(`/scan/${f.slug}`);
  const hint = page.getByText('Tap the screen once so the phone can vibrate on each scan.');
  await expect(hint).toBeVisible();
  await page.keyboard.press('Shift'); // an activation that changes nothing else: only the activation listener can hide it
  await expect(hint).toBeHidden();
  await chooseCheckpoint(page, 'Raffle');
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'ready');
  await readerOn(page);

  await nfcTap(page, serialOf(uid));
  await expect.poll(vibrations).toEqual([[30, 60, 30]]);
  const result = page.getByTestId('scan-result');
  await expect(result).toBeHidden(); // the tick came before any answer
  release();
  await expect(result).toHaveAttribute('data-tone', 'green');
  expect(await vibrations()).toEqual([[30, 60, 30], [60]]);

  // An unreadable tag while the green result is up is ignored (no amber over green); once it's gone, amber + notice.
  await nfcUnreadable(page);
  expect(await vibrations()).toEqual([[30, 60, 30], [60]]);
  await expect(page.getByText('Couldn’t read that badge')).toHaveCount(0);
  await expect(result).toBeHidden({ timeout: 4000 });
  await nfcUnreadable(page);
  await expect(page.getByText('Couldn’t read that badge. Hold it still and try again.')).toBeVisible();
  expect(await vibrations()).toEqual([[30, 60, 30], [60], [80, 80, 80]]);
});

test('T-NFC-10: taps still arrive after a garbage collection (a collected reader swallowed every tap on a real phone)', async ({ page }) => {
  await installFakeNfc(page);
  const { uid } = await f.linkBadge(f.p.B);
  await openScanner(page, 'Raffle');
  await readerOn(page);
  expect(await page.evaluate(() => typeof (window as unknown as { gc?: unknown }).gc)).toBe('function');
  await forceGc(page);
  await nfcTap(page, serialOf(uid));
  await expect(page.getByTestId('scan-result')).toHaveAttribute('data-tone', 'green');
});

test('T-NFC-23: NFC badges mode turns the camera off and keeps the reader on; the choice survives a reload; Camera brings the camera back', async ({ page }) => {
  await installFakeNfc(page);
  await trackCameraStreams(page);
  const { uid } = await f.linkBadge(f.p.N);
  const scans: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/scan')) scans.push(r.url());
  });
  await openScanner(page, 'Raffle');
  await expect(page.getByRole('button', { name: 'Camera', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await readerOn(page);
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'off');
  expect(await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).srcObject)).toBeNull();
  expect(await liveCameraTracks(page)).toBe(0); // the camera itself is off, not just hidden
  expect(await nfcActive(page)).toBe(1);
  await expect(page.getByRole('button', { name: /Badge reader/ })).toHaveCount(0); // always on: no off switch

  // Reload: still in badge mode, camera off. Chrome needs a tap to start NFC unless permission was granted.
  await page.reload();
  await expect(page.getByRole('button', { name: 'NFC badges' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'off');
  await page.getByRole('button', { name: 'Start badge reader' }).click();
  await expect(page.getByText('Ready: tap a badge on the back of the phone')).toBeVisible();
  await nfcTap(page, serialOf(uid));
  await expect(page.getByTestId('scan-result')).toHaveAttribute('data-tone', 'green');
  await expect(page.getByTestId('scan-result')).toBeHidden({ timeout: 4000 });

  // Back to the camera: it starts again, the reader stops, and a badge tap (a fresh one, so the dedupe can't
  // hide a request) sends nothing.
  await page.getByRole('button', { name: 'Camera', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'ready');
  expect(await nfcActive(page)).toBe(0);
  const before = scans.length;
  await nfcTap(page, serialOf(randomUid()));
  await page.waitForTimeout(1000);
  expect(scans.length).toBe(before);
  await expect(page.getByTestId('scan-result')).toBeHidden();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Camera', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'ready');
});

test('T-NFC-23: switching to NFC badges while the camera is still starting leaves it off', async ({ page }) => {
  await installFakeNfc(page);
  await trackCameraStreams(page, 1500); // a slow camera start (as with a permission prompt)
  await page.goto(`/scan/${f.slug}`);
  await chooseCheckpoint(page, 'Raffle');
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'starting');
  await page.getByRole('button', { name: 'NFC badges' }).click();
  await page.waitForTimeout(2500); // past the slow start
  expect(await page.evaluate(() => (window as unknown as { __streams: MediaStream[] }).__streams.length)).toBe(1); // it did open
  expect(await liveCameraTracks(page)).toBe(0); // ...and was released at once
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'off');
});

test('T-NFC-23: with the NFC permission already granted, NFC mode starts the reader by itself after a reload, exactly once', async ({ page }) => {
  await installFakeNfc(page);
  await stubNfcPermission(page, 'granted');
  await openScanner(page, 'Raffle');
  await readerOn(page);
  expect(await nfcActive(page)).toBe(1); // the tap's reader, not replaced by an auto-start
  await page.reload();
  await expect(page.getByText('Ready: tap a badge on the back of the phone')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start badge reader' })).toHaveCount(0);
  expect(await nfcActive(page)).toBe(1);
});

for (const mode of ['existing', 'failed'] as const) {
  test(`T-NFC-29: Manual search links with a ${mode} profile write and restores the camera`, async ({ page }) => {
    await installFakeNfc(page);
    await trackCameraStreams(page);
    if (mode === 'failed') await page.addInitScript(() => {
      (window as unknown as { NDEFReader: { prototype: { write: () => Promise<void> } } }).NDEFReader.prototype.write = async () => { throw new Error('read only'); };
    });
    await openScanner(page);
    await page.getByRole('button', { name: 'Manual search' }).click();
    await page.getByPlaceholder('Type a name').fill('nia');
    await page.getByRole('button', { name: /^(Link|Replace) badge for Nia Fixture$/ }).click();
    await expect.poll(() => nfcActive(page)).toBe(1); // v0.12.4: the reader starts 0.8 s after the camera closes
    const uid = randomUid();
    await nfcTap(page, serialOf(uid), mode === 'existing' ? [`https://badges.example.test/profile/${uid}?tap`] : []);
    const sheet = page.getByRole('dialog', { name: 'Link a badge' });
    const suffix = mode === 'existing' ? '' : " Couldn't write its profile link: hold the badge still and tap Link badge again.";
    await expect(sheet).toContainText(`✓ Badge ${serialOf(uid)} linked to Nia Fixture.${suffix}`);
    expect(await nfcWrites(page)).toEqual([]);
    expect((await f.pool.query('select participant_id from badges where uid = $1', [uid])).rows).toEqual([{ participant_id: f.p.N }]);
    await expect(page.getByTestId('scan-result')).toBeHidden();
    await sheet.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('main')).toHaveAttribute('data-camera', 'ready');
    expect(await liveCameraTracks(page)).toBe(1);
    expect(await nfcActive(page)).toBe(0);
  });
}

for (const cancel of ['different tag', 'close', 'timeout'] as const) {
  test(`T-NFC-29: a pending profile write is aborted on ${cancel} and still links only the original badge`, async ({ page }) => {
    await installFakeNfc(page, 'pending');
    await openScanner(page);
    await readerOn(page);
    const scans: string[] = [];
    page.on('request', (r) => {
      if (r.url().endsWith('/api/scan')) scans.push(r.url());
    });
    await page.getByRole('button', { name: 'Manual search' }).click();
    await page.getByPlaceholder('Type a name').fill('nia');
    await page.getByRole('button', { name: /^(Link|Replace) badge for Nia Fixture$/ }).click();
    const uid = randomUid();
    const other = randomUid();
    await nfcTap(page, serialOf(uid));
    await expect.poll(() => nfcWrites(page)).toHaveLength(1);
    const sheet = page.getByRole('dialog', { name: 'Link a badge' });
    await expect(sheet).toContainText('Linking badge…');
    if (cancel === 'different tag') await nfcTap(page, serialOf(other));
    if (cancel === 'close') await sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
    const notice = cancel === 'close' ? page.getByRole('status') : sheet;
    await expect(notice).toContainText(`✓ Badge ${serialOf(uid)} linked to Nia Fixture. Couldn't write its profile link: hold the badge still and tap Link badge again.`, { timeout: 10000 });
    expect(await page.evaluate(() => (window as unknown as { __nfcWriteAborted: boolean }).__nfcWriteAborted)).toBe(true);
    expect(await nfcWrites(page)).toEqual([{ records: [{ recordType: 'url', data: `https://badges.example.test/profile/${uid}?tap` }] }]);
    expect((await f.pool.query('select participant_id from badges where uid = $1', [uid])).rows).toEqual([{ participant_id: f.p.N }]);
    expect((await f.pool.query('select participant_id from badges where uid = $1', [other])).rows).toEqual([]);
    expect(scans).toEqual([]);
    await expect(page.getByTestId('scan-result')).toBeHidden();
  });
}

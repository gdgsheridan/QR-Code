import { expect, test, type Locator } from '@playwright/test';
import { signIn } from '../fixtures/e2e';
import { createAccount, createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
test.beforeAll(async () => { f = await createStandardFixture(); });
test.afterAll(async () => { await f?.close(); });

test('T-UI-05: Atom follows a drag within the gutter, keeps moving after a toss, and stays dropped with reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const email = (await f.pool.query<{ email: string }>('select email from participants where id = $1', [f.p.A])).rows[0]?.email;
  if (!email) throw new Error('Fixture participant must have an email');
  await createAccount(email);
  await signIn(page, email, '/me');
  const atom = page.locator('[data-atom]');
  await expect(atom).toHaveCSS('opacity', '1');
  await expect(atom).toHaveCSS('background-image', /atom-wave\.webp/);
  const at = async () => {
    const box = await atom.boundingBox();
    if (!box) throw new Error('Atom must have a bounding box');
    return box;
  };
  const insideLane = async () => {
    const box = await at();
    const main = await page.getByRole('main').boundingBox();
    if (!main) throw new Error('Main column must have a bounding box');
    // Never over the content (v0.11.30: he goes around it), and inside the window.
    expect(box.x >= main.x + main.width || box.x + box.width <= main.x || box.y >= main.y + main.height || box.y + box.height <= main.y).toBe(true);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1440);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(900);
  };

  let box = await at();
  let cx = box.x + box.width / 2;
  let cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await expect(atom).toHaveCSS('cursor', 'grabbing');
  const grabbed = await at();
  const dx = cx < 720 ? (cx < 169 ? 15 : -15) : (cx < 1271 ? 15 : -15); // toward the middle of his side's space
  const dy = cy < 450 ? 100 : -100;
  await page.mouse.move(cx + dx, cy + dy, { steps: 8 });
  const dragged = await at();
  // Centres: held, he swings (T-UI-07), which changes his rotated box but not where he is.
  expect(Math.abs(dragged.x + dragged.width / 2 - grabbed.x - grabbed.width / 2 - dx)).toBeLessThan(5);
  expect(Math.abs(dragged.y + dragged.height / 2 - grabbed.y - grabbed.height / 2 - dy)).toBeLessThan(5);
  await insideLane();
  // Pointer capture keeps working outside the image; every edge clamps the image to its gutter.
  await page.mouse.move(0, -100, { steps: 4 });
  await insideLane();
  await page.mouse.move(1540, 1000, { steps: 4 });
  await insideLane();
  await page.mouse.move(1270, 450, { steps: 4 });
  await page.waitForTimeout(100); // Drop without a toss before measuring a fresh throw.
  await page.mouse.up();

  box = await at();
  cx = box.x + box.width / 2;
  cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let step = 1; step <= 2; step++) {
    await page.waitForTimeout(20);
    await page.mouse.move(cx, cy + step * 20);
  }
  await page.mouse.up();
  const released = await at();
  await page.waitForTimeout(300);
  const tossed = await at();
  expect(tossed.y + tossed.height / 2 - released.y - released.height / 2).toBeGreaterThan(15);
  await page.waitForTimeout(2500);
  await insideLane();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(atom).toHaveCSS('opacity', '1');
  box = await at();
  cx = box.x + box.width / 2;
  cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const stillGrabbed = await at();
  const stillDy = cy < 450 ? 100 : -100;
  await page.mouse.move(cx, cy + stillDy, { steps: 8 });
  await page.mouse.up();
  const dropped = await at();
  expect(Math.abs(dropped.y - stillGrabbed.y - stillDy)).toBeLessThan(1);
  await insideLane();
  await page.waitForTimeout(1000);
  expect(await at()).toEqual(dropped);
});

test('T-UI-05: Atom dropped on the content floats off it, a throw at the content bounces off, and he spawns on either side', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const email = (await f.pool.query<{ email: string }>('select email from participants where id = $1', [f.p.B])).rows[0]?.email;
  if (!email) throw new Error('Fixture participant must have an email');
  await createAccount(email);
  await signIn(page, email, '/me');
  const atom = page.locator('[data-atom]');
  await expect(atom).toHaveCSS('opacity', '1');
  const boxes = async () => {
    const [a, main] = await Promise.all([atom.boundingBox(), page.getByRole('main').boundingBox()]);
    if (!a || !main) throw new Error('Atom and the content must have boxes');
    return { a, main, clear: a.x >= main.x + main.width || a.x + a.width <= main.x || a.y >= main.y + main.height || a.y + a.height <= main.y };
  };
  // Drag him onto the middle of the page (allowed while held), let go: he floats off it and stays clear.
  let { a } = await boxes();
  const cx = a.x + a.width / 2;
  const cy = a.y + a.height / 2;
  const right = cx > 720;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(720, cy, { steps: 10 });
  expect((await boxes()).clear).toBe(false); // over the content while held
  await page.waitForTimeout(150); // hold still: a drop, not a throw
  await page.mouse.up();
  await expect.poll(async () => (await boxes()).clear, { timeout: 4000 }).toBe(true);
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(100);
    expect((await boxes()).clear).toBe(true);
  }
  // Throw him at the content from the far side of his space: he bounces off, never over it.
  ({ a } = await boxes());
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  const outer = right ? 1440 : 0;
  await page.mouse.move(outer, ay, { steps: 4 }); // pinned at the window edge
  ({ a } = await boxes());
  const from = a.x + a.width / 2;
  await page.mouse.move(from, ay);
  await page.waitForTimeout(150);
  await page.mouse.move(from + (right ? -20 : 20), ay);
  await page.mouse.move(from + (right ? -40 : 40), ay);
  await page.mouse.up();
  for (let i = 0; i < 10; i++) {
    expect((await boxes()).clear).toBe(true);
    await page.waitForTimeout(100);
  }
  // A fresh load picks a side at random: both turn up.
  const sides = new Set<string>();
  for (let i = 0; i < 12 && sides.size < 2; i++) {
    await page.reload();
    await expect(atom).toHaveCSS('opacity', '1');
    ({ a } = await boxes());
    sides.add(a.x + a.width / 2 < 720 ? 'left' : 'right');
  }
  expect([...sides].sort()).toEqual(['left', 'right']);
});

test('T-UI-06: Atom waves now and then (the side Atom and the /me corner one), and never with reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const email = (await f.pool.query<{ email: string }>('select email from participants where id = $1', [f.p.N])).rows[0]?.email;
  if (!email) throw new Error('Fixture participant must have an email');
  await createAccount(email);
  await signIn(page, email, '/me');
  // Within `ms`, does a wave (the sprite stepping through its 8 frames) run on the element? Its easing, or null.
  const waves = (locator: Locator, ms: number) => locator.evaluate((el, wait) => new Promise<string | null>((resolve) => {
    const end = performance.now() + wait;
    const look = () => {
      const wave = el.getAnimations().find((a) => a.effect instanceof KeyframeEffect
        && a.effect.getKeyframes().some((frame) => 'backgroundPositionX' in frame));
      if (wave || performance.now() > end) resolve(wave?.effect ? String(wave.effect.getTiming().easing) : null);
      else requestAnimationFrame(look);
    };
    look();
  }), ms);
  const atom = page.locator('[data-atom]');
  await expect(atom).toHaveCSS('opacity', '1');
  await expect(atom).toHaveCSS('background-position-x', /^0(px|%)?$/); // frame 1 at rest
  expect(await waves(atom, 9000)).toMatch(/^steps\(8/); // the first wave comes 2-8 s after he appears
  await expect(atom).toHaveCSS('background-position-x', /^0(px|%)?$/, { timeout: 3000 }); // and he's back on frame 1

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const corner = page.locator('[data-atom-corner]');
  await expect(corner).toBeVisible();
  expect(await waves(corner, 9000)).toMatch(/^steps\(8/);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(atom).toHaveCSS('opacity', '1');
  expect(await waves(atom, 10_000)).toBeNull();
  await expect(atom).toHaveCSS('background-position-x', /^0(px|%)?$/);
});

test('T-UI-07: picking Atom up plays his grab animation and swings him; letting go settles him back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const email = (await f.pool.query<{ email: string }>('select email from participants where id = $1', [f.p.Rv])).rows[0]?.email;
  if (!email) throw new Error('Fixture participant must have an email');
  await createAccount(email);
  await signIn(page, email, '/me');
  const atom = page.locator('[data-atom]');
  await expect(atom).toHaveCSS('opacity', '1');
  // The grab loop: an endless 8-step animation of the sprite's background position. Its easing, or null.
  const grabbing = () => atom.evaluate((el) => {
    const loop = el.getAnimations().find((a) => a.playState === 'running' && a.effect instanceof KeyframeEffect
      && a.effect.getTiming().iterations === Infinity && a.effect.getKeyframes().some((frame) => 'backgroundPositionX' in frame));
    return loop?.effect ? String(loop.effect.getTiming().easing) : null;
  });
  const rotation = () => atom.evaluate((el) => {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return Math.atan2(m.b, m.a) * 180 / Math.PI;
  });
  // The most extreme rotation either way over the next `ms`, sampled every frame.
  const swingOver = (ms: number) => atom.evaluate((el, wait) => new Promise<{ min: number; max: number }>((resolve) => {
    let min = Infinity;
    let max = -Infinity;
    const end = performance.now() + wait;
    const look = () => {
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      const angle = Math.atan2(m.b, m.a) * 180 / Math.PI;
      min = Math.min(min, angle);
      max = Math.max(max, angle);
      if (performance.now() > end) resolve({ min, max });
      else requestAnimationFrame(look);
    };
    look();
  }), ms);
  const centre = async () => {
    const box = await atom.boundingBox();
    if (!box) throw new Error('Atom must have a bounding box');
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  let { x, y } = await centre();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(atom).toHaveCSS('background-image', /atom-grab\.webp/);
  expect(await grabbing()).toMatch(/^steps\(8/);
  // Bring him to the left of the window (he may have spawned on the right), let him hang still, then carry him right
  // quickly: he leans left, away from the way he's carried.
  await page.mouse.move(200, 450, { steps: 10 });
  await page.waitForTimeout(1500);
  x = 200;
  y = 450;
  const swing = swingOver(700);
  for (let step = 1; step <= 12; step++) {
    await page.mouse.move(x + step * 15, y);
    await page.waitForTimeout(16);
  }
  expect((await swing).min).toBeLessThan(-4);
  expect(await grabbing()).toMatch(/^steps\(8/); // still flailing while held
  await page.mouse.up();
  await expect(atom).toHaveCSS('background-image', /atom-wave\.webp/, { timeout: 500 });
  expect(await grabbing()).toBeNull();
  await expect.poll(async () => Math.abs(await rotation()), { timeout: 2000 }).toBeLessThan(7); // back to his ±6° rest tilt

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(atom).toHaveCSS('opacity', '1');
  ({ x, y } = await centre());
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(atom).toHaveCSS('background-image', /atom-wave\.webp/);
  expect(await grabbing()).toBeNull();
  const still = swingOver(400);
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(x + (x < 720 ? step : -step) * 15, y);
    await page.waitForTimeout(16);
  }
  const range = await still;
  expect(Math.max(Math.abs(range.min), Math.abs(range.max))).toBeLessThan(0.01);
  await page.mouse.up();
});

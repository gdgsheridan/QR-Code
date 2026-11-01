import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Browser, type Page } from '@playwright/test';
import { formatUid } from '@/lib/domain/badge';
import { STAFF_PASSWORD } from './standard';

export const E2E_ORIGIN = 'http://localhost:3100';
// Browser contexts without JavaScript also reduce motion: Playwright waits between click retries with a page-side
// setTimeout, which never fires with JavaScript off, so a click that first meets the page's CSS entrance hangs.
export const NO_JS = { javaScriptEnabled: false, reducedMotion: 'reduce' } as const;

export function authStatePath(name: string): string {
  const dir = join(process.cwd(), 'tests', 'e2e', '.auth');
  mkdirSync(dir, { recursive: true });
  return join(dir, `${name}.json`);
}

// The real sign-in: login page → email + password → `next` (SPEC F9, v0.4).
export async function signIn(page: Page, email: string, next: string, password = STAFF_PASSWORD): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => url.pathname + url.search === next);
}

// Signs in once per spec file and saves cookies for `test.use({ storageState })`.
export async function saveSignedInState(browser: Browser, email: string, file: string): Promise<void> {
  // Explicit empty state: the runner would otherwise apply the file's (not yet written) storageState.
  const context = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await signIn(page, email, '/me');
  await context.storageState({ path: file });
  await context.close();
}

export const fakeCameraArgs = (videoFile?: string) => [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  ...(videoFile ? [`--use-file-for-fake-video-capture=${videoFile}`] : []),
];

// Web NFC fake (CLAUDE.md mock list): a `window.NDEFReader` that tests drive with `nfcTap`. Every
// started reader receives each tap; `write()` calls are recorded in `window.__nfcWrites`.
export async function installFakeNfc(page: Page, writeMode: 'success' | 'fail' | 'pending' = 'success'): Promise<void> {
  await page.addInitScript((writeMode) => {
    const w = window as unknown as Record<string, unknown>;
    // Held weakly, like Chrome: a reader the page doesn't keep a reference to can be collected while
    // scanning, and its taps then go nowhere (the real-phone bug behind T-NFC-10's GC case).
    const readers = new Set<WeakRef<EventTarget>>();
    const writes: unknown[] = [];
    class FakeNDEFReader extends EventTarget {
      async scan(options: { signal?: AbortSignal } = {}): Promise<void> {
        const ref = new WeakRef<EventTarget>(this);
        readers.add(ref);
        options.signal?.addEventListener('abort', () => readers.delete(ref));
      }
      async write(message: unknown, options: { signal?: AbortSignal } = {}): Promise<void> {
        writes.push(message);
        if (writeMode === 'fail') throw new DOMException('Read only', 'NotAllowedError');
        if (writeMode === 'pending') await new Promise<void>((_, reject) => {
          options.signal?.addEventListener('abort', () => {
            w.__nfcWriteAborted = true;
            reject(new DOMException('Cancelled', 'AbortError'));
          }, { once: true });
        });
      }
    }
    w.__nfcWriteAborted = false;
    w.NDEFReader = FakeNDEFReader;
    w.__nfcWrites = writes;
    w.__nfcTap = (serialNumber: string, urls: string[]) => {
      const records = urls.map((u) => ({ recordType: 'url', data: new DataView(new TextEncoder().encode(u).buffer) }));
      for (const r of readers) r.deref()?.dispatchEvent(Object.assign(new Event('reading'), { serialNumber, message: { records } }));
    };
    w.__nfcActive = () => [...readers].filter((r) => r.deref()).length;
    // A tag sensed but not read (Chrome fires 'readingerror').
    w.__nfcUnreadable = () => {
      for (const r of readers) r.deref()?.dispatchEvent(new Event('readingerror'));
    };
  }, writeMode);
}

type NfcWindow = { __nfcTap(serial: string, urls: string[]): void; __nfcUnreadable(): void; __nfcActive(): number; __nfcWrites: unknown[] };

/** Readers currently scanning (started and not aborted). */
export async function nfcActive(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as NfcWindow).__nfcActive());
}

/** Records every camera stream the page opens, so tests can check the camera itself is released. */
export async function trackCameraStreams(page: Page, delayMs = 0): Promise<void> {
  await page.addInitScript((delay) => {
    const w = window as unknown as { __streams: MediaStream[] };
    w.__streams = [];
    const open = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) =>
      new Promise((resolve, reject) =>
        setTimeout(
          () =>
            open(c).then((s) => {
              w.__streams.push(s);
              resolve(s);
            }, reject),
          delay,
        ),
      );
  }, delayMs);
}

/** Live camera tracks among every stream the page opened (0 = the camera is really off). */
export async function liveCameraTracks(page: Page): Promise<number> {
  return page.evaluate(() =>
    (window as unknown as { __streams: MediaStream[] }).__streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').length,
  );
}

/** Needs Chromium launched with `--js-flags=--expose-gc`. */
export async function forceGc(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) await page.evaluate(() => (window as unknown as { gc(): void }).gc());
}

export async function nfcUnreadable(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as NfcWindow).__nfcUnreadable());
}

export async function nfcTap(page: Page, serial: string, urls: string[] = []): Promise<void> {
  await page.evaluate(([s, u]) => (window as unknown as NfcWindow).__nfcTap(s, u), [serial, urls] as const);
}

export async function nfcWrites(page: Page): Promise<unknown[]> {
  return page.evaluate(() => (window as unknown as NfcWindow).__nfcWrites);
}

/** Chrome's serial-number format for a stored UID: "04a1b2c3" → "04:A1:B2:C3". */
export const serialOf = formatUid;

export async function chooseCheckpoint(page: Page, name: string): Promise<void> {
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(`^\\S*\\s*${name}\\b`) }).click();
  await expect(page.getByTestId('checkpoint-banner')).toContainText(name);
}

// `next dev` compiles each route on its first request (seconds). Timing assertions are about the
// scanner, not the dev compiler, so hit the routes once first. Production has no such step.
export async function warmDevServer(slug: string): Promise<void> {
  await Promise.all([
    fetch(`${E2E_ORIGIN}/api/scan`, { method: 'POST', body: '{}' }),
    fetch(`${E2E_ORIGIN}/api/events/${slug}/checkpoints`),
    fetch(`${E2E_ORIGIN}/api/events/${slug}/participants/search?q=ab`),
    fetch(`${E2E_ORIGIN}/scan/${slug}`, { redirect: 'manual' }),
  ]);
}

// The e2e server sends with EMAIL_PROVIDER=console, which writes .eml files to ./.mail (SPEC §12).
// Returns the plain-text body of the newest message to `to` that contains `needle`.
export async function consoleMailText(to: string, needle: string, timeoutMs = 15_000): Promise<string> {
  const dir = join(process.cwd(), '.mail');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const files = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.eml')).sort().reverse() : [];
    for (const name of files) {
      const raw = readFileSync(join(dir, name), 'utf8');
      if (!raw.includes(`\r\nTo: ${to}\r\n`)) continue;
      const part = /Content-Type: text\/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/.exec(raw)?.[1];
      const text = Buffer.from((part ?? '').replace(/\r\n/g, ''), 'base64').toString('utf8');
      if (text.includes(needle)) return text;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`no console email to ${to} containing ${needle}`);
}

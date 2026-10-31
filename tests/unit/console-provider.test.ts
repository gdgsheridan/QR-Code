import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConsoleProvider } from '@/lib/email/console';
import type { EmailMessage } from '@/lib/email/provider';

afterEach(() => {
  vi.restoreAllMocks();
});

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function message(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    to: 'ada@example.com',
    from: 'Station <passes@example.com>',
    subject: "You're in: Hack Day — your check-in pass",
    html: '<p>Hi Ada</p><img src="cid:qr">',
    text: 'Hi Ada',
    inlineImages: [{ cid: 'qr', filename: 'station-qr.png', contentType: 'image/png', content: png }],
    idempotencyKey: 'row-1:1',
    fileLabel: 'Hack-Day-Ada',
    ...overrides,
  };
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'station-mail-'));
}

describe('console email provider (SPEC §12)', () => {
  it('T-MAIL-10: writes the message to the mail dir and never calls the network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const dir = await tempDir();
    const res = await createConsoleProvider({ dir }).send(message());
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.id).toMatch(/^console-/);
    const emls = (await readdir(dir)).filter((f) => f.endsWith('.eml'));
    expect(emls).toHaveLength(1);
    const eml = await readFile(join(dir, emls[0] ?? ''), 'utf8');
    expect(eml).toContain('To: ada@example.com');
    expect(eml).toContain('Content-ID: <qr>');
    expect(eml).toContain('Content-Type: text/plain; charset=utf-8');
    expect(eml).toContain('Content-Type: text/html; charset=utf-8');
  });

  it('T-MAIL-10: defaults to ./.mail', () => {
    expect(createConsoleProvider().name).toBe('console');
  });

  it('T-MAIL-13: also saves the QR image as qr/<Event>-<First>.png, byte for byte', async () => {
    const dir = await tempDir();
    await createConsoleProvider({ dir }).send(message());
    expect(await readdir(join(dir, 'qr'))).toEqual(['Hack-Day-Ada.png']);
    expect(await readFile(join(dir, 'qr', 'Hack-Day-Ada.png'))).toEqual(png);
  });

  it('T-MAIL-13: never overwrites; a second pass with the same name gets -2, then -3', async () => {
    const dir = await tempDir();
    const provider = createConsoleProvider({ dir });
    const second = Buffer.concat([png, Buffer.from([2])]);
    await provider.send(message());
    await provider.send(message({ inlineImages: [{ cid: 'qr', filename: 'q.png', contentType: 'image/png', content: second }] }));
    await provider.send(message());
    expect((await readdir(join(dir, 'qr'))).sort()).toEqual(['Hack-Day-Ada-2.png', 'Hack-Day-Ada-3.png', 'Hack-Day-Ada.png']);
    expect(await readFile(join(dir, 'qr', 'Hack-Day-Ada-2.png'))).toEqual(second);
  });

  it('T-MAIL-13: concurrent sends with the same name all get their own file', async () => {
    const dir = await tempDir();
    const provider = createConsoleProvider({ dir });
    await Promise.all(Array.from({ length: 10 }, () => provider.send(message())));
    expect(await readdir(join(dir, 'qr'))).toHaveLength(10);
  });

  it('T-MAIL-13: a hostile or missing label cannot escape the qr folder', async () => {
    const dir = await tempDir();
    const provider = createConsoleProvider({ dir });
    await provider.send(message({ fileLabel: '../../outside' }));
    await provider.send(message({ fileLabel: undefined }));
    expect((await readdir(join(dir, 'qr'))).sort()).toEqual(['outside.png', 'pass.png']);
  });
});

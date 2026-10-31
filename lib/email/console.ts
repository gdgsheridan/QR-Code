import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeUniqueFile } from '@/lib/dev/files';
import { toFileLabel } from '@/lib/domain/file-label';
import type { EmailMessage, EmailProvider, InlineImage } from './provider';

// Dev/test provider (SPEC §12): writes an .eml file you can open in a mail client, plus each inline
// image (the QR code) as its own file in <dir>/qr/, named "<Event>-<First>.png" (T-MAIL-13). No network.
export function createConsoleProvider(opts: { dir?: string } = {}): EmailProvider {
  const dir = opts.dir ?? join(process.cwd(), '.mail');
  return {
    name: 'console',
    async send(message) {
      const id = `console-${randomUUID()}`;
      await mkdir(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await writeFile(join(dir, `${stamp}-${id}.eml`), toMime(message, id), 'utf8');
      // Re-sanitize: fileLabel is untrusted input as far as the file system is concerned.
      const label = toFileLabel(message.fileLabel ?? '');
      for (const img of message.inlineImages) {
        await writeUniqueFile(join(dir, 'qr'), label, extensionFor(img), img.content);
      }
      return { id };
    },
  };
}

function extensionFor(img: InlineImage): string {
  if (img.contentType === 'image/png') return '.png';
  if (img.contentType === 'image/jpeg') return '.jpg';
  return '.bin';
}

function wrap64(buf: Buffer): string {
  return (buf.toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
}

function toMime(m: EmailMessage, id: string): string {
  const rel = `rel-${id}`;
  const alt = `alt-${id}`;
  const lines = [
    `From: ${m.from}`,
    `To: ${m.to}`,
    `Subject: =?utf-8?B?${Buffer.from(m.subject, 'utf8').toString('base64')}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${id}@station.local>`,
    `X-Idempotency-Key: ${m.idempotencyKey}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/related; boundary="${rel}"`,
    '',
    `--${rel}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap64(Buffer.from(m.text, 'utf8')),
    `--${alt}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap64(Buffer.from(m.html, 'utf8')),
    `--${alt}--`,
    ...m.inlineImages.flatMap((img) => [
      `--${rel}`,
      `Content-Type: ${img.contentType}; name="${img.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-ID: <${img.cid}>`,
      `Content-Disposition: inline; filename="${img.filename}"`,
      '',
      wrap64(img.content),
    ]),
    `--${rel}--`,
    '',
  ];
  return lines.join('\r\n');
}

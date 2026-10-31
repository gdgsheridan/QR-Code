import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from '@/lib/email/provider';
import { createResendProvider } from '@/lib/email/resend';

const message = {
  to: 'ada@example.com',
  from: 'Station <passes@example.com>',
  subject: 's',
  html: '<img src="cid:qr">',
  text: 't',
  inlineImages: [{ cid: 'qr', filename: 'station-qr.png', contentType: 'image/png', content: Buffer.from('png') }],
  idempotencyKey: 'row-1:2',
};

describe('resend provider (SPEC §12, §17 A1)', () => {
  it('T-MAIL-07: sends the QR as an inline content_id attachment with an idempotency key', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ id: 'msg_1' }));
    const res = await createResendProvider({ apiKey: 'k', fetchImpl }).send(message);
    expect(res.id).toBe('msg_1');
    const [, init] = fetchImpl.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe('row-1:2');
    const body: unknown = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      to: ['ada@example.com'],
      attachments: [{ filename: 'station-qr.png', content_id: 'qr', content_type: 'image/png', content: 'cG5n' }],
    });
  });

  it('T-MAIL-13: the dev-only fileLabel is never sent to Resend', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ id: 'msg_1' }));
    await createResendProvider({ apiKey: 'k', fetchImpl }).send({ ...message, fileLabel: 'Hack-Day-Ada' });
    const [, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(init?.body)).not.toContain('Hack-Day-Ada');
    expect(String(init?.body)).not.toContain('fileLabel');
  });

  it('T-MAIL-04: a 429 surfaces Retry-After and keeps the response body out of the error', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response('{"message":"too many for ada@example.com"}', { status: 429, headers: { 'Retry-After': '120' } }),
    );
    const err = await createResendProvider({ apiKey: 'k', fetchImpl }).send(message).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ status: 429, retryAfterSeconds: 120 });
    expect(String(err)).not.toContain('@');
  });
});

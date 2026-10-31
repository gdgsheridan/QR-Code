import type { EmailProvider } from './provider';
import { ProviderError } from './provider';

// Resend over plain fetch (SPEC §17 A1, verified: Idempotency-Key header, inline `content_id`).
// Open/click tracking is a per-domain setting in Resend and MUST be off (SPEC §12).
// v0.11.25: a hung request gives up after timeoutMs as a retryable 504 (it used to hold the row until the
// 10-minute claim lease ran out, and a reclaimed row could be sent twice), and sends from one instance are spaced
// minIntervalMs apart (5 a second, under Resend's default team limit); a 429 still ends the batch (F4).
export function createResendProvider(opts: { apiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number; minIntervalMs?: number }): EmailProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const minIntervalMs = opts.minIntervalMs ?? 200;
  let nextSlot = 0;
  async function waitTurn() {
    const now = Date.now();
    const at = Math.max(now, nextSlot);
    nextSlot = at + minIntervalMs;
    if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));
  }
  return {
    name: 'resend',
    async send(m) {
      await waitTurn();
      let res: Response;
      try {
        res = await doFetch('https://api.resend.com/emails', {
          signal: AbortSignal.timeout(timeoutMs),
          method: 'POST',
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': m.idempotencyKey,
          },
          body: JSON.stringify({
            from: m.from,
            to: [m.to],
            subject: m.subject,
            html: m.html,
            text: m.text,
            attachments: m.inlineImages.map((i) => ({
              filename: i.filename,
              content: i.content.toString('base64'),
              content_type: i.contentType,
              content_id: i.cid,
            })),
          }),
        });
      } catch (err) {
        if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) throw new ProviderError('Resend timed out', 504);
        throw err;
      }
      if (!res.ok) {
        const retryAfter = Number(res.headers.get('retry-after'));
        // The response body may echo the recipient; never put it in the error.
        throw new ProviderError(`Resend responded ${res.status}`, res.status, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
      }
      const body: unknown = await res.json();
      const id = typeof body === 'object' && body !== null && 'id' in body && typeof body.id === 'string' ? body.id : '';
      if (!id) throw new ProviderError('Resend response had no id', 502);
      return { id };
    },
  };
}

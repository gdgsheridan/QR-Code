import { randomUUID } from 'node:crypto';
import { signSheetBody } from '@/lib/domain/hmac';
import type { SheetRowInput } from '@/lib/domain/sheet';
import { drainUntilIdle } from '@/lib/email/drain';
import { createIngestHandler } from '@/lib/ingest/handler';
import { requireEnv } from './db';
import { mockProvider, serviceClient } from './mail';

export const INGEST_SECRET = () => requireEnv('SHEET_INGEST_SECRET');

// A signed-request client for the ingest handler, with a mock mail provider behind the drain.
export function ingestClient() {
  const db = serviceClient();
  const mail = mockProvider();
  const scheduled: Array<() => Promise<unknown>> = [];
  // Until idle: rows other files left due would otherwise crowd this test's row out of a 20-row batch.
  const drain = () =>
    drainUntilIdle({ db, provider: mail.provider, appOrigin: 'http://localhost:3100', from: 'Station <p@localhost>', passSecret: requireEnv('PASS_TOKEN_SECRET') });
  const handler = createIngestHandler({ db, secret: INGEST_SECRET(), scheduleDrain: (t) => scheduled.push(t), drain });

  async function post(
    body: unknown,
    o: { ts?: number; secret?: string; signature?: string | null; timestamp?: string | null; contentLength?: string; legacyHeaders?: boolean } = {},
  ): Promise<Response> {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    const ts = String(o.ts ?? Math.floor(Date.now() / 1000));
    const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' };
    const timestamp = o.timestamp === undefined ? ts : o.timestamp;
    const signature = o.signature === undefined ? signSheetBody(raw, ts, o.secret ?? INGEST_SECRET()) : o.signature;
    const prefix = o.legacyHeaders ? 'x-passline' : 'x-station';
    if (timestamp !== null) headers[`${prefix}-timestamp`] = timestamp;
    if (signature !== null) headers[`${prefix}-signature`] = signature;
    if (o.contentLength) headers['content-length'] = o.contentLength;
    return handler(new Request('http://localhost/api/ingest/sheet', { method: 'POST', headers, body: raw }));
  }

  async function ingest(slug: string, rows: SheetRowInput[]): Promise<string[]> {
    const res = await post({ event_slug: slug, rows });
    if (res.status !== 200) throw new Error(`ingest returned ${res.status}`);
    const body = (await res.json()) as { results: Array<{ external_id: string; result: string }> };
    return body.results.map((r) => r.result);
  }

  return { db, mail, scheduled, drain, post, ingest };
}

export function sheetRow(slug: string, over: Partial<SheetRowInput> = {}): Required<SheetRowInput> {
  return {
    external_id: randomUUID(),
    email: `r-${randomUUID().slice(0, 8)}@${slug}.test`,
    first_name: 'Row',
    last_name: 'Person',
    dietary_notes: '',
    linkedin_url: '',
    status: 'Accepted',
    ...over,
  };
}

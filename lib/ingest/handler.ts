import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/lib/db/types.gen';
import { verifySheetSignature } from '@/lib/domain/hmac';
import { ingestRows } from './rows';

// SPEC §9.2. Order: size → signature over the raw body → JSON/schema → event → rows.
export const MAX_BODY_BYTES = 1024 * 1024;

const cell = z.string().max(100_000).optional();
const rowSchema = z
  .object({
    external_id: cell,
    email: cell,
    first_name: cell,
    last_name: cell,
    dietary_notes: cell,
    linkedin_url: cell,
    status: cell,
  })
  .strict();
const bodySchema = z.object({ event_slug: z.string().min(1).max(100), rows: z.array(rowSchema).max(500) }).strict();

export interface IngestDeps {
  db: SupabaseClient<Database>;
  secret: string;
  /** Runs `task` after the response is sent (Next.js `after()` in production). */
  scheduleDrain: (task: () => Promise<unknown>) => void;
  drain: () => Promise<unknown>;
  nowSeconds?: () => number;
}

const status = (code: number, error: string) => Response.json({ error }, { status: code });

export function createIngestHandler(deps: IngestDeps) {
  return async (request: Request): Promise<Response> => {
    if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return status(413, 'too_large');
    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return status(413, 'too_large');

    const verified = verifySheetSignature({
      rawBody: raw,
      // X-Passline-* is the pre-rename name: Apps Scripts already pasted into Sheets still send it.
      timestamp: request.headers.get('x-station-timestamp') ?? request.headers.get('x-passline-timestamp'),
      signature: request.headers.get('x-station-signature') ?? request.headers.get('x-passline-signature'),
      secret: deps.secret,
      nowSeconds: (deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))(),
    });
    if (!verified) return status(401, 'bad_signature');

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return status(400, 'invalid_json');
    }
    const body = bodySchema.safeParse(json);
    if (!body.success) return status(400, 'invalid_body');

    const { data: event, error } = await deps.db.from('events').select('id').eq('slug', body.data.event_slug).maybeSingle();
    if (error) throw new Error(`event lookup failed (${error.code})`);
    if (!event) return status(404, 'unknown_event');

    const results = await ingestRows(deps.db, event.id, body.data.rows, { dryRun: false });
    // Never send inline (SPEC §2 Outbox, T-ING-20): the drain runs after the response.
    if (results.some((r) => r.result === 'PASS_QUEUED')) deps.scheduleDrain(deps.drain);
    return Response.json({ results });
  };
}

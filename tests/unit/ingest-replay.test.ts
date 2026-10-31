import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types.gen';
import { ingestReplayKey, signSheetBody } from '@/lib/domain/hmac';
import { createIngestHandler } from '@/lib/ingest/handler';

const secret = 's'.repeat(40);
const now = 1_790_000_000;

// Minimal stub: records rpc calls, answers the seen-set and the event lookup, counts row upserts.
function stubDb(seenAnswers: boolean[]) {
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];
  let rowUpserts = 0;
  const db = {
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      if (fn === 'record_ingest_request') return { data: seenAnswers.shift() ?? true, error: null };
      if (fn === 'ingest_sheet_row') {
        rowUpserts += 1;
        return { data: 'CREATED', error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { id: 'e1' }, error: null }),
        }),
      }),
    }),
  };
  return { db: db as unknown as SupabaseClient<Database>, rpcCalls, rowUpserts: () => rowUpserts };
}

const row = { external_id: 'a1', email: 'r@example.test', first_name: 'Row' };

function signedRequest(raw: string, ts: number, sigSecret: string = secret) {
  const tsStr = String(ts);
  return new Request('http://localhost/api/ingest/sheet', {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-station-timestamp': tsStr,
      'x-station-signature': signSheetBody(raw, tsStr, sigSecret),
    },
    body: raw,
  });
}

describe('ingest replay protection (L2, SPEC §9.2)', () => {
  it('L2: a fresh signed request records its key and is processed', async () => {
    const { db, rpcCalls } = stubDb([true]);
    const handler = createIngestHandler({ db, secret, scheduleDrain: () => {}, drain: async () => {}, nowSeconds: () => now });
    const raw = JSON.stringify({ event_slug: 'e', rows: [row] });
    const res = await handler(signedRequest(raw, now));
    expect(res.status).toBe(200);
    const tsStr = String(now);
    expect(rpcCalls[0]).toEqual({
      fn: 'record_ingest_request',
      args: { p_key: ingestReplayKey(tsStr, signSheetBody(raw, tsStr, secret)) },
    });
  });

  it('L2: replaying the same (timestamp, signature) is rejected 401 before any upsert', async () => {
    const { db, rowUpserts } = stubDb([false]);
    const handler = createIngestHandler({ db, secret, scheduleDrain: () => {}, drain: async () => {}, nowSeconds: () => now });
    const raw = JSON.stringify({ event_slug: 'e', rows: [row] });
    const res = await handler(signedRequest(raw, now));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'replay' });
    expect(rowUpserts()).toBe(0);
  });

  it('L2: the same payload re-signed with a fresh timestamp is a new key and still works', async () => {
    const { db } = stubDb([true]);
    const drained: Array<() => Promise<unknown>> = [];
    const handler = createIngestHandler({
      db,
      secret,
      scheduleDrain: (t) => drained.push(t),
      drain: async () => {},
      nowSeconds: () => now + 60,
    });
    const raw = JSON.stringify({ event_slug: 'e', rows: [row] });
    const res = await handler(signedRequest(raw, now + 60));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [{ external_id: 'a1', result: 'CREATED' }] });
  });

  it('L2: the replay key binds timestamp and signature (pure helper)', async () => {
    const ts = String(now);
    const sig = signSheetBody('{}', ts, secret);
    expect(ingestReplayKey(ts, sig)).toBe(`${ts}.${sig}`);
    // Same body re-signed a second later is a different key: re-ingest keeps working.
    expect(ingestReplayKey(String(now + 1), signSheetBody('{}', String(now + 1), secret))).not.toBe(ingestReplayKey(ts, sig));
    // Same timestamp, different body (different signature) is a different key.
    expect(ingestReplayKey(ts, signSheetBody('{"a":1}', ts, secret))).not.toBe(ingestReplayKey(ts, sig));
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createScanHandler, createVoidHandler } from '@/lib/scan/handlers';
import type { Database } from '@/lib/db/types.gen';
import { sha256hex } from '@/lib/domain/token';

type Db = SupabaseClient<Database>;
const USER = { id: '11111111-2222-4333-8444-555555555555', email: null };
const authenticate = () => Promise.resolve(USER);
const SCAN_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

interface RpcCall {
  fn: string;
  args: unknown;
}

function voidDb(rateOk: boolean) {
  const rpcCalls: RpcCall[] = [];
  const rpc = (...args: unknown[]) => {
    const [fn, rpcArgs] = args as [string, unknown];
    rpcCalls.push({ fn, args: rpcArgs });
    if (fn === 'rate_limit_hit') return Promise.resolve({ data: rateOk, error: null });
    if (fn === 'void_scan') return Promise.resolve({ data: { code: 'VOIDED' }, error: null });
    throw new Error(`unexpected rpc ${fn}`);
  };
  return { db: { rpc } as unknown as Db, rpcCalls };
}

function scanDb(reserve: { allowed: boolean; reservation_id: number | null }) {
  const rpcCalls: RpcCall[] = [];
  let updated: unknown = null;
  let inserted: unknown = null;
  const rpc = (...args: unknown[]) => {
    const [fn, rpcArgs] = args as [string, unknown];
    rpcCalls.push({ fn, args: rpcArgs });
    if (fn === 'scan_rate_reserve') return Promise.resolve({ data: reserve, error: null });
    if (fn === 'record_scan')
      return Promise.resolve({
        data: {
          code: 'ACCEPTED',
          replayed: false,
          scanId: 'scan-1',
          participant: { id: 'p-1', displayName: 'A B', status: 'accepted' },
        },
        error: null,
      });
    throw new Error(`unexpected rpc ${fn}`);
  };
  const from = (table: string) => {
    if (table === 'checkpoints') {
      const q = {
        select: (...chain: unknown[]) => {
          void chain;
          return q;
        },
        eq: (...chain: unknown[]) => {
          void chain;
          return q;
        },
        maybeSingle: () => Promise.resolve({ data: { event_id: 'event-1' }, error: null }),
      };
      return q;
    }
    if (table === 'scan_attempts')
      return {
        update: (row: unknown) => ({
          eq: (...chain: unknown[]) => {
            void chain;
            updated = row;
            return Promise.resolve({ error: null });
          },
        }),
        insert: (row: unknown) => {
          inserted = row;
          return Promise.resolve({ error: null });
        },
      };
    throw new Error(`unexpected table ${table}`);
  };
  return { db: { rpc, from } as unknown as Db, rpcCalls, audit: () => ({ updated, inserted }) };
}

const voidReq = (id: string) =>
  new Request(`http://localhost/api/scans/${id}/void`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'wrong person, undoing' }),
  });

const scanReq = (clientScannedAt: string) =>
  new Request('http://localhost/api/scan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      checkpointId: '0b8b4e0e-9a1c-4c5e-8a55-4b8f3e0d6c11',
      method: 'qr',
      token: 'Ab3_-xYz0123456789abcdefGHIJKLMN',
      clientScanId: '3f2b7a9e-1c4d-4e8f-9a0b-2c3d4e5f6a7b',
      clientScannedAt,
    }),
  });

describe('POST /api/scans/[id]/void rate limit (L3)', () => {
  it('L3: an over-limit staffer gets the 429 rate_limited shape without reaching void_scan', async () => {
    const { db, rpcCalls } = voidDb(false);
    const res = await createVoidHandler({ db, authenticate })(voidReq(SCAN_ID), { id: SCAN_ID });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect(rpcCalls.map((c) => c.fn)).toEqual(['rate_limit_hit']);
  });

  it('L3: the limit key holds a hash of the user id, never the raw id', async () => {
    const { db, rpcCalls } = voidDb(true);
    const res = await createVoidHandler({ db, authenticate })(voidReq(SCAN_ID), { id: SCAN_ID });
    expect(res.status).toBe(200);
    const hit = rpcCalls.find((c) => c.fn === 'rate_limit_hit');
    const args = hit?.args as { p_key: string; p_window_seconds: number; p_limit: number };
    expect(args.p_window_seconds).toBe(60);
    expect(args.p_limit).toBe(60);
    expect(args.p_key).not.toContain(USER.id);
    expect(args.p_key).toContain(sha256hex(USER.id).slice(0, 32));
  });
});

describe('POST /api/scan atomic rate gate (L4)', () => {
  it('L4: a denied reservation returns 429 without calling record_scan or writing audit rows', async () => {
    const { db, rpcCalls, audit } = scanDb({ allowed: false, reservation_id: null });
    const res = await createScanHandler({ db, authenticate })(scanReq(new Date().toISOString()));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect(rpcCalls.map((c) => c.fn)).toEqual(['scan_rate_reserve']);
    expect(audit()).toEqual({ updated: null, inserted: null });
  });

  it('L4: an allowed reservation completes its row (update, not a second insert)', async () => {
    const { db, rpcCalls, audit } = scanDb({ allowed: true, reservation_id: 42 });
    const res = await createScanHandler({ db, authenticate })(scanReq(new Date().toISOString()));
    expect(res.status).toBe(200);
    expect((await res.json() as { code: string }).code).toBe('ACCEPTED');
    expect(rpcCalls.map((c) => c.fn)).toEqual(['scan_rate_reserve', 'record_scan']);
    const { updated, inserted } = audit();
    expect(inserted).toBeNull();
    expect(updated).toMatchObject({ result_code: 'ACCEPTED', staff_user_id: USER.id });
  });

  it('L4+L5: a backdated clientScannedAt is clamped before it reaches record_scan', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-10-31T12:00:00.000Z'));
    try {
      const { db, rpcCalls } = scanDb({ allowed: true, reservation_id: 7 });
      await createScanHandler({ db, authenticate })(scanReq('2026-10-31T11:00:00.000Z'));
      const scan = rpcCalls.find((c) => c.fn === 'record_scan');
      const args = scan?.args as { p_client_scanned_at: string };
      expect(args.p_client_scanned_at).toBe('2026-10-31T11:55:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });
});

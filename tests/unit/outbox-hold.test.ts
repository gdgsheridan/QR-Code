import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Database } from '@/lib/db/types.gen';
import { createConsoleProvider, isLocalDatabase } from '@/lib/email/console';
import { drainOutbox } from '@/lib/email/drain';

describe('console provider on a shared database (SPEC F4, v0.11.27)', () => {
  it('T-MAIL-16: only a Supabase on this machine counts as local', () => {
    expect(['http://127.0.0.1:54321', 'http://localhost:54321', 'http://[::1]:54321'].map(isLocalDatabase)).toEqual([true, true, true]);
    expect(['https://yruehdyzhybtwhhyflws.supabase.co', 'http://10.0.0.5:54321', 'not a url', ''].map(isLocalDatabase)).toEqual([false, false, false, false]);
  });

  it('T-MAIL-16: a held console provider claims nothing, so the emails stay queued for the deployed drainer', async () => {
    const calls: string[] = [];
    const fake = { rpc: async (fn: string) => { calls.push(fn); return { data: [], error: null }; } };
    const opts = { db: fake as unknown as SupabaseClient<Database>, appOrigin: 'https://station.example.com', from: 'x <x@example.test>', passSecret: 'p'.repeat(32) };
    expect(await drainOutbox({ ...opts, provider: createConsoleProvider({ holdQueue: true }) })).toEqual({ claimed: 0, sent: 0, retrying: 0, failed: 0, cancelled: 0, rateLimited: false });
    expect(calls).toEqual([]);
    await drainOutbox({ ...opts, provider: createConsoleProvider() });
    expect(calls).toEqual(['claim_outbox']);
  });
});

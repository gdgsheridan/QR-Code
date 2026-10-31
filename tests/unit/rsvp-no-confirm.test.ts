import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Database } from '@/lib/db/types.gen';
import { createRsvpHandler } from '@/lib/rsvp/handlers';

// L6: RSVP "No" needs the explicit confirm flag. The gate sits before any lookup, so the stub DB
// only answers the two rate-limit RPCs and would fail the test if touched otherwise.
const dbStub = {
  // Within limits for both rate RPCs; empty lookup so gate-passing calls reach the 404 path.
  rpc: async (name: string) => (name === 'rsvp_lookup' ? { data: null, error: null } : { data: true, error: null }),
} as unknown as SupabaseClient<Database>;
const handler = createRsvpHandler({ db: dbStub, scheduleDrain: () => undefined, drain: async () => undefined, signIn: async () => 'wrong' });
const post = (body: unknown) =>
  handler(
    new Request('http://localhost/api/rsvp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.9.0.1' },
      body: JSON.stringify(body),
    }),
  );

describe('rsvp No confirmation (L6)', () => {
  it('T-RSVP-03 (L6): going:false without confirmNo is refused before any lookup', async () => {
    for (const body of [{ token: 't', going: false }, { token: 't', going: false, confirmNo: false }]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'confirm_required' });
    }
  });

  it('T-RSVP-03 (L6): going:false with confirmNo:true passes the gate (unknown token still 404)', async () => {
    const res = await post({ token: 't', going: false, confirmNo: true });
    expect(res.status).toBe(404); // past the gate, lookup finds nothing
  });

  it('T-RSVP-03 (L6): going:true and the prefill lookup are unchanged by the gate', async () => {
    const prefill = await post({ token: 't' });
    expect(prefill.status).toBe(404);
    const yes = await post({ token: 't', going: true, password: 'x' });
    expect(yes.status).not.toBe(400); // schema accepts it; it fails later at lookup/sign-in, not at the gate
  });
});

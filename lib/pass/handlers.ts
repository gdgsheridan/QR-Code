import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/lib/db/types.gen';
import { passState, type PassLookup } from '@/lib/domain/pass-state';
import { sha256hex } from '@/lib/domain/token';

type Db = SupabaseClient<Database>;

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

const lookupSchema = z.object({
  pass: z.object({ id: z.string(), revokedAt: z.string().nullable(), revokeReason: z.string().nullable() }),
  participant: z.object({
    id: z.string(),
    eventId: z.string(),
    firstName: z.string(),
    status: z.string(),
    deleted: z.boolean(),
    profilePublic: z.boolean(),
    hasLinkedin: z.boolean(),
  }),
  event: z.object({ name: z.string(), venue: z.string(), startsAt: z.string(), timezone: z.string() }),
});

// Any string is hashed and looked up, so malformed and unknown tokens take the same path (T-PASS-02).
async function lookupToken(db: Db, token: string): Promise<PassLookup | null> {
  const { data, error } = await db.rpc('pass_lookup', { p_token_hash: sha256hex(token) });
  if (error) throw new Error(`pass_lookup failed (${error.code})`);
  return data === null ? null : lookupSchema.parse(data);
}

export async function withinLimit(db: Db, key: string, windowSeconds: number, limit: number): Promise<boolean> {
  const { data, error } = await db.rpc('rate_limit_hit', { p_key: key, p_window_seconds: windowSeconds, p_limit: limit });
  if (error) throw new Error(`rate_limit_hit failed (${error.code})`);
  return data;
}

// The IP is only used hashed, so no raw address is stored (I-11).
export function ipKey(headers: Headers, scope = 'pass'): string {
  const ip = headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || 'unknown';
  return `${scope}:ip:${sha256hex(ip).slice(0, 32)}`;
}

// Per email only: a whole venue can share one IP. Keys hold hashes only (I-11).
export const emailKey = (scope: string, email: string) => `${scope}:email:${sha256hex(email).slice(0, 32)}`;

const passBody = z.object({ token: z.string().max(512) }).strict();

// POST /api/pass (SPEC F5, §9.3): token in the body only, never in a URL (I-3).
export function createPassHandler(deps: { db: Db }) {
  return async (request: Request): Promise<Response> => {
    if (!(await withinLimit(deps.db, ipKey(request.headers), 60, 30))) return json({ error: 'rate_limited' }, 429);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return json({ error: 'invalid_body' }, 400);
    }
    const body = passBody.safeParse(raw);
    if (!body.success) return json({ error: 'invalid_body' }, 400);

    const found = await lookupToken(deps.db, body.data.token);
    const state = passState(found);
    if (state === 'not_found' || !found) return json({ state: 'not_found' }, 404);
    if (state !== 'active') return json({ state });

    const { participant, event } = found;
    // v0.11.27 (owner's request): the pass shows their full name. pass_lookup has only the first name.
    const { data: names, error } = await deps.db.from('participants').select('last_name').eq('id', participant.id).single();
    if (error) throw new Error(`pass name lookup failed (${error.code})`);
    return json({
      state,
      firstName: participant.firstName,
      lastName: names.last_name,
      event,
      profile: { public: participant.profilePublic, hasLinkedin: participant.hasLinkedin },
    });
  };
}

const profileBody = z.object({ token: z.string().max(512), profilePublic: z.boolean() }).strict();

// PATCH /api/pass (SPEC §6.5, §9.3): the pass holder opts in or out of the badge profile.
// Same token-in-body auth and per-IP limit as POST; only an active pass may change it.
export function createPassProfileHandler(deps: { db: Db }) {
  return async (request: Request): Promise<Response> => {
    if (!(await withinLimit(deps.db, ipKey(request.headers), 60, 30))) return json({ error: 'rate_limited' }, 429);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return json({ error: 'invalid_body' }, 400);
    }
    const body = profileBody.safeParse(raw);
    if (!body.success) return json({ error: 'invalid_body' }, 400);

    const found = await lookupToken(deps.db, body.data.token);
    if (!found || passState(found) !== 'active') return json({ state: 'not_found' }, 404);

    const { error } = await deps.db.rpc('set_profile_public', {
      p_participant_id: found.participant.id,
      p_public: body.data.profilePublic,
    });
    if (error) throw new Error(`set_profile_public failed (${error.code})`);
    return json({ profile: { public: body.data.profilePublic, hasLinkedin: found.participant.hasLinkedin } });
  };
}

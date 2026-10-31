import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/lib/db/types.gen';
import { sanitizeError } from '@/lib/domain/outbox';
import { parseProfileInput } from '@/lib/domain/profile';
import { sha256hex } from '@/lib/domain/token';
import { profileArgs } from '@/lib/me/profile';
import { emailKey, overIpCeiling, overLinkLimit, withinLimit } from '@/lib/pass/handlers';
import { shownReplyBy } from '@/lib/domain/rsvp';

type Db = SupabaseClient<Database>;

/** `next`: where /login would send them (e.g. staff onboarding first). 'wrong': GoTrue refused the password.
 * 'error': anything else (rate limit, 5xx), never shown as a wrong password. */
export type SignInOutcome = { next: string } | 'wrong' | 'error';

export interface RsvpDeps {
  db: Db;
  /** Signs the browser in (sets the session cookie). */
  signIn: (email: string, password: string) => Promise<SignInOutcome>;
  /** Runs `task` after the response is sent (Next.js `after()` in production). */
  scheduleDrain: (task: () => Promise<unknown>) => void;
  drain: () => Promise<unknown>;
}

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

const lookupSchema = z.object({
  email: z.string(),
  firstName: z.string(),
  status: z.string(),
  hasAccount: z.boolean(),
  profile: z.object({ dietaryNotes: z.string().nullable(), linkedinUrl: z.string().nullable(), profilePublic: z.boolean() }),
  event: z.object({ name: z.string(), venue: z.string(), startsAt: z.string(), timezone: z.string() }),
  // v0.9: when the invitation stops taking a Yes, and whether it has (never for the accepted).
  closesAt: z.string().nullable().transform((at) => at && new Date(at).toISOString()),
  closed: z.boolean(),
  // v0.11.28: the date they're asked to reply by (the invitation closes at closesAt).
  replyBy: z.string().nullable().transform((at) => at && new Date(at).toISOString()),
});

const field = z.string().max(1000).optional(); // lengths are checked by parseProfileInput
const rsvpBody = z
  .object({
    token: z.string().max(512),
    going: z.boolean().optional(),
    password: z.string().max(200).optional(),
    // L6: the destructive answer needs an explicit confirm step (the UI types "give away" first),
    // so a leaked link alone cannot silently revoke the spot.
    confirmNo: z.boolean().optional(),
    // Optional since v0.9 (the Yes form sends only the password; the profile is set up after, F14). Still
    // accepted, and checked, from older pages.
    emergencyName: field,
    emergencyPhone: field,
    emergencyRelation: field,
    dietaryNotes: field,
    linkedin: field,
    profilePublic: z.boolean().optional(),
    lookingForTeam: z.boolean().optional(),
  })
  .strict();

// POST /api/rsvp (SPEC F13, §9.3). The RSVP token travels only in the body (I-3); same per-IP limit as
// /api/pass. `{token}` looks the invitation up; `{token, going, password}` answers it. A Yes always needs
// a password (v0.7.2): someone without an account sets one (the emailed link proved the address); someone
// with an account enters theirs, checked like a sign-in with its own per-email limit (only the token holder
// gets here, so burning /login's tries can't block a Yes). Either way they end up signed in, and an existing
// account's password is never changed here. Everything is checked before anything changes (no account is
// made for a refused answer). JSON bodies only: a cross-site form
// can't send one, so no other site can post a Yes and sign a visitor into someone else's account.
export function createRsvpHandler(deps: RsvpDeps) {
  return async (request: Request): Promise<Response> => {
    if (await overIpCeiling(deps.db, request.headers, 'rsvp')) return json({ error: 'rate_limited' }, 429);
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({ error: 'invalid_body' }, 400);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return json({ error: 'invalid_body' }, 400);
    }
    const body = rsvpBody.safeParse(raw);
    if (!body.success) return json({ error: 'invalid_body' }, 400);
    // Before any lookup or rate-limit burn: a No without the confirm step is refused, so the
    // emailed link alone cannot revoke. Same response for unknown tokens (no oracle).
    if (body.data.going === false && body.data.confirmNo !== true) return json({ error: 'confirm_required' }, 400);
    if (await overLinkLimit(deps.db, 'rsvp', body.data.token)) return json({ error: 'rate_limited' }, 429);

    const hash = sha256hex(body.data.token);
    const { data, error } = await deps.db.rpc('rsvp_lookup', { p_token_hash: hash });
    if (error) throw new Error(`rsvp_lookup failed (${error.code})`);
    if (data === null) return json({ state: 'not_found' }, 404);
    const found = lookupSchema.parse(data);
    const { going, password = '' } = body.data;
    if (going === undefined) {
      // The prefill holds the Sheet's dietary notes and LinkedIn, never the email or the emergency contact.
      return json({ firstName: found.firstName, event: found.event, status: found.status, hasAccount: found.hasAccount, profile: found.profile, closesAt: found.closesAt, closed: found.closed, replyBy: shownReplyBy(found.replyBy, found.closesAt, new Date()) });
    }
    // Past the deadline (F13, v0.9): refused before any account is made or signed into.
    if (going && found.closed) return json({ error: 'closed' }, 409);
    const profile = going ? parseProfileInput(body.data, { requireEmergency: false }) : null;
    if (profile && !profile.ok) return json({ error: 'invalid_profile', field: profile.field }, 400);

    if (going && password === '') return json({ error: 'password_required' }, 400);

    let landing: string | null = null;
    let newAccount = going && !found.hasAccount;
    if (newAccount) {
      // 8–72: bcrypt ignores anything longer. Checked before anything changes.
      if (password.length < 8 || password.length > 72) return json({ error: 'weak_password' }, 400);
      const created = await deps.db.auth.admin.createUser({ email: found.email, password, email_confirm: true });
      if (created.error?.code === 'weak_password') return json({ error: 'weak_password' }, 400);
      // Any other failure is most likely an account that appeared since the lookup (a double tap): email_exists,
      // or GoTrue's bare 500 when two creates race (v0.11.25). Either way it needs its own password, below:
      // the right one signs in and answers, a wrong one is refused, and GoTrue being down is still a 500.
      if (created.error) newAccount = false;
    }
    if (going && !newAccount) {
      // Over the limit looks like a wrong password, as on /login (§15).
      if (!(await withinLimit(deps.db, emailKey('rsvp-signin', found.email), 900, 10))) return json({ error: 'wrong_password' }, 400);
      const outcome = await deps.signIn(found.email, password);
      if (outcome === 'error') throw new Error('RSVP sign-in failed');
      if (outcome === 'wrong') return json({ error: 'wrong_password' }, 400);
      landing = outcome.next;
    }

    const { data: code, error: respondError } = await deps.db.rpc('rsvp_respond', {
      p_token_hash: hash,
      p_going: going,
      p_looking_for_team: body.data.lookingForTeam,
      ...(profile?.ok && profileArgs(profile.value)),
    });
    if (respondError) throw new Error(`rsvp_respond failed (${respondError.code})`);
    if (code === 'NOT_FOUND') return json({ state: 'not_found' }, 404);
    if (code === 'CLOSED') return json({ error: 'closed' }, 409); // the deadline passed since the lookup
    // Never send inline (SPEC §2 Outbox): the pass email goes out after the response.
    if (code === 'GOING') deps.scheduleDrain(deps.drain);
    // A new account whose sign-in fails here keeps its answer: they're told to sign in (signedIn: false).
    if (newAccount) {
      try {
        const outcome = await deps.signIn(found.email, password);
        if (typeof outcome === 'object') landing = outcome.next;
      } catch (err) {
        console.error(JSON.stringify({ level: 'error', where: 'rsvp.signIn', error: sanitizeError(err) }));
      }
    }
    return json(landing === null ? { code, signedIn: false } : { code, signedIn: true, next: landing });
  };
}

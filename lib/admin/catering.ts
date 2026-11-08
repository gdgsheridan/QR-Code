import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { secretEquals } from '@/lib/auth/secret';
import type { Database } from '@/lib/db/types.gen';
import { passToken } from '@/lib/domain/token';
import { overIpCeiling, overLinkLimit } from '@/lib/pass/handlers';
import { RETENTION_DAYS } from '@/lib/privacy/retention';

type Db = SupabaseClient<Database>;

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

export interface CateringHacker { name: string; dietaryNotes: string | null; allergies: string | null; allergySeverity: string | null }

// §11 (v0.11.39): accepted, real, undeleted hackers' dietary notes and allergies, by name. Never email.
export async function cateringHackers(db: Db, eventId: string): Promise<CateringHacker[]> {
  // shortcut: PostgREST caps a read at 1000 rows; one event's accepted hackers are a few hundred.
  const { data, error } = await db
    .from('participants')
    .select('first_name, last_name, dietary_notes, allergies, allergy_severity')
    .eq('event_id', eventId)
    .eq('status', 'accepted')
    .is('deleted_at', null)
    .eq('is_test', false);
  if (error) throw new Error(`catering load failed (${error.code})`);
  return data
    .map((p) => ({ name: `${p.first_name} ${p.last_name}`.trim(), dietaryNotes: p.dietary_notes, allergies: p.allergies, allergySeverity: p.allergy_severity }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

// The share link's key is derived like a pass token (§6.1) from the event's random catering_link_id, so organizers
// can copy it again; the prefix keeps it from ever equalling a pass token. It travels only in the URL fragment.
export const cateringToken = (secret: string, linkId: string) => passToken(secret, `catering:${linkId}`);
export const cateringUrl = (origin: string, slug: string, token: string) => `${origin}/catering/${slug}#${token}`;

const shareBody = z.object({ slug: z.string().regex(/^[a-z0-9-]{3,40}$/), token: z.string().max(512) }).strict();

// POST /api/catering (§11, §9.3): anyone holding the organizers' link reads the Catering list. Unknown event, no
// link, a wrong or reset key, or 30 days after the event (retention has deleted the notes, §15): the same 404.
export function createCateringShareHandler(deps: { db: Db; passSecret: string; now?: () => Date }) {
  return async (request: Request): Promise<Response> => {
    if (await overIpCeiling(deps.db, request.headers, 'catering')) return json({ error: 'rate_limited' }, 429);
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return json({ error: 'invalid_body' }, 400);
    }
    const body = shareBody.safeParse(raw);
    if (!body.success) return json({ error: 'invalid_body' }, 400);
    if (await overLinkLimit(deps.db, 'catering', body.data.token)) return json({ error: 'rate_limited' }, 429);

    const { data: event, error } = await deps.db.from('events').select('id, name, ends_at, catering_link_id').eq('slug', body.data.slug).maybeSingle();
    if (error) throw new Error(`event load failed (${error.code})`);
    const now = (deps.now ?? (() => new Date()))().getTime();
    const live = event?.catering_link_id && Date.parse(event.ends_at) + RETENTION_DAYS * 86_400_000 > now;
    if (!event || !live || !secretEquals(body.data.token, cateringToken(deps.passSecret, event.catering_link_id ?? ''))) {
      return json({ state: 'not_found' }, 404);
    }
    return json({ event: { name: event.name }, hackers: await cateringHackers(deps.db, event.id) });
  };
}

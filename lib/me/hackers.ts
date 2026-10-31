import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/lib/db/types.gen';
import { normalizeEmail, toSearchText } from '@/lib/domain/normalize';
import type { MyEvent } from './profile';

const person = z.union([
  z.object({ id: z.uuid(), name: z.string(), bio: z.string().nullable(), pace: z.enum(['competitive', 'balanced', 'casual']).nullable(), teamName: z.string().nullable(), looking: z.boolean(), linkedinUrl: z.string().nullable(), discord: z.string().nullable(), websiteUrl: z.string().nullable() }).strict(),
  z.object({ id: z.uuid(), name: z.string() }).strict(),
]);

export const DIRECTORY_PAGE = 50;
export const DIRECTORY_MAX = 1000;

// Call only after myEvent confirms the viewer. No participant id comes from the request.
// v0.11.25 (F16 step 4): filters run in the database before the limit; `show` rows, and whether there are more.
export async function hackerDirectory(db: SupabaseClient<Database>, me: MyEvent, email: string,
  filters: { looking: boolean; search: string; pace: string; show?: number }) {
  const show = Math.min(Math.max(filters.show ?? DIRECTORY_PAGE, 1), DIRECTORY_MAX);
  const { data, error } = await db.rpc('hacker_directory', {
    p_event_id: me.eventId, p_email: normalizeEmail(email), p_looking: filters.looking,
    p_query: toSearchText(filters.search), ...(filters.pace && { p_pace: filters.pace }), p_limit: show + 1,
  });
  if (error) throw new Error(`hacker directory failed (${error.code})`);
  const people = z.array(person).parse(data);
  return { people: people.slice(0, show), more: people.length > show };
}

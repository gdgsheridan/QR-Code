import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/lib/db/types.gen';

type Db = SupabaseClient<Database>;

const mineSchema = z
  .object({
    cooldownMinutes: z.number(),
    /** When the next workshop check-in opens, while a cooldown runs; null otherwise. */
    availableAt: z.string().nullable(),
    /** The database clock when this was read (I-7): countdowns run from it, never the device clock. */
    serverTime: z.string(),
    workshops: z.array(z.object({ name: z.string(), scannedAt: z.string() }).strict()),
  })
  .strict();
export type MyWorkshops = z.infer<typeof mineSchema>;

// SPEC F14 step 8: the signed-in hacker's live workshop (session checkpoint) scans, newest first. Only with
// the participant id the server resolved from the session (myEvent()), never one from a request.
export async function myWorkshops(db: Db, participantId: string): Promise<MyWorkshops> {
  const { data, error } = await db.rpc('my_workshops', { p_participant_id: participantId });
  if (error) throw new Error(`my_workshops failed (${error.code})`);
  return mineSchema.parse(data);
}

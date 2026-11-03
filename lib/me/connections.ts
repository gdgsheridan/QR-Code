import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/lib/db/types.gen';
import { normalizeUid } from '@/lib/domain/badge';
import { normalizeEmail } from '@/lib/domain/normalize';
import { emailKey, withinLimit } from '@/lib/pass/handlers';

type Db = SupabaseClient<Database>;
type Account = { id: string; email?: string | null };

// SPEC F17 (v0.12): what record_connection() answers, plus the rate limit.
const CONNECT_CODES = ['PENDING', 'MUTUAL', 'ALREADY_PENDING', 'ALREADY_MUTUAL', 'SELF', 'NOT_FOUND', 'NOT_ATTENDEE', 'NOT_CHECKED_IN', 'CLOSED'] as const;
export type ConnectCode = (typeof CONNECT_CODES)[number] | 'RATE_LIMITED';
export type ConnectResult = { code: ConnectCode; firstName?: string };
const connectSchema = z.object({ code: z.enum(CONNECT_CODES), firstName: z.string().optional() }).strict();

const STATES = ['NONE', 'SENT', 'RECEIVED', 'MUTUAL', 'SELF', 'NOT_FOUND', 'NOT_ATTENDEE', 'NOT_CHECKED_IN', 'CLOSED'] as const;
export type ConnectionState = (typeof STATES)[number];

export interface MyConnections {
  total: number;
  waitingOn: number;
  recent: Array<{ firstName: string; lastName: string; linkedinUrl: string | null; badgeUid: string | null; connectedAt: string }>;
}
const mineSchema = z.object({
  total: z.number(),
  waitingOn: z.number(),
  recent: z.array(z.object({ firstName: z.string(), lastName: z.string(), linkedinUrl: z.string().nullable(), badgeUid: z.string().nullable(), connectedAt: z.string() })),
});

// The tapper is the signed-in account (verified email); a badge UID only identifies the other person (I-16).
// 120 presses per account per hour (§15).
export async function connect(db: Db, user: Account, uid: string): Promise<ConnectResult> {
  const badge = normalizeUid(uid);
  if (!user.email || !badge) return { code: 'NOT_FOUND' };
  const email = normalizeEmail(user.email);
  if (!(await withinLimit(db, emailKey('connect', email), 3600, 120))) return { code: 'RATE_LIMITED' };
  const { data, error } = await db.rpc('record_connection', { p_email: email, p_uid: badge });
  if (error) throw new Error(`record_connection failed (${error.code})`);
  return connectSchema.parse(data);
}

export async function connectionState(db: Db, user: Account, uid: string): Promise<ConnectionState> {
  const badge = normalizeUid(uid);
  if (!user.email || !badge) return 'NOT_FOUND';
  const { data, error } = await db.rpc('connection_state', { p_email: normalizeEmail(user.email), p_uid: badge });
  if (error) throw new Error(`connection_state failed (${error.code})`);
  return z.enum(STATES).parse(data);
}

// Only with the participant id the server resolved from the session (myEvent()), never one from a request.
export async function myConnections(db: Db, participantId: string, limit: number): Promise<MyConnections> {
  const { data, error } = await db.rpc('my_connections', { p_participant_id: participantId, p_limit: limit });
  if (error) throw new Error(`my_connections failed (${error.code})`);
  return mineSchema.parse(data);
}

// F17 step 6: their own points and rank on the leaderboard (as of the freeze, if frozen). Session-resolved id only.
export async function myRank(db: Db, participantId: string): Promise<{ points: number; rank: number | null }> {
  const { data, error } = await db.rpc('connection_rank', { p_participant_id: participantId });
  if (error) throw new Error(`connection_rank failed (${error.code})`);
  return z.object({ points: z.number(), rank: z.number().nullable() }).strict().parse(data);
}

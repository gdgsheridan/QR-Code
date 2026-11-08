import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types.gen';

// SPEC F17 / §11 Leaderboard (v0.12.4, owner's request and decision): organizers can look up one hacker's connections
// and remove one (both taps), e.g. a joke or a test pair. Always scoped to the guarded event.
type Db = SupabaseClient<Database>;

export interface HackerConnection { id: string; name: string; state: 'mutual' | 'sent' | 'received' }

// Everyone this hacker has a tap with, either way: mutual first, then by name. Null if they aren't in this event.
export async function hackerConnections(db: Db, eventId: string, participantId: string): Promise<HackerConnection[] | null> {
  const { data: who, error: e1 } = await db.from('participants').select('id').eq('id', participantId).eq('event_id', eventId).maybeSingle();
  if (e1) throw new Error(`participant lookup failed (${e1.code})`);
  if (!who) return null;
  const { data: taps, error: e2 } = await db.from('connection_taps').select('from_participant_id, to_participant_id')
    .eq('event_id', eventId).or(`from_participant_id.eq.${participantId},to_participant_id.eq.${participantId}`);
  if (e2) throw new Error(`taps lookup failed (${e2.code})`);
  const sides = new Map<string, { out: boolean; in: boolean }>();
  for (const t of taps) {
    const other = t.from_participant_id === participantId ? t.to_participant_id : t.from_participant_id;
    const s = sides.get(other) ?? { out: false, in: false };
    if (t.from_participant_id === participantId) s.out = true;
    else s.in = true;
    sides.set(other, s);
  }
  if (sides.size === 0) return [];
  const { data: people, error: e3 } = await db.from('participants').select('id, first_name, last_name').in('id', [...sides.keys()]);
  if (e3) throw new Error(`names lookup failed (${e3.code})`);
  const order = { mutual: 0, received: 1, sent: 2 } as const;
  return people
    .map((p) => {
      const s = sides.get(p.id)!;
      return { id: p.id, name: `${p.first_name} ${p.last_name}`.trim(), state: s.out && s.in ? 'mutual' as const : s.out ? 'sent' as const : 'received' as const };
    })
    .sort((a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name));
}

// Deletes both taps between two hackers of this event; returns how many went (0 when there were none).
export async function removeConnection(db: Db, eventId: string, a: string, b: string): Promise<number> {
  const { data, error } = await db.from('connection_taps').delete().eq('event_id', eventId)
    .or(`and(from_participant_id.eq.${a},to_participant_id.eq.${b}),and(from_participant_id.eq.${b},to_participant_id.eq.${a})`)
    .select('from_participant_id');
  if (error) throw new Error(`connection remove failed (${error.code})`);
  return data.length;
}

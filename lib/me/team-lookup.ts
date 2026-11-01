import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types.gen';
import { toSearchText } from '@/lib/domain/normalize';
import type { MyEvent } from './profile';

// Call only after loadMyEvent/myEvent authorizes the viewer; never take an event from the request.
export async function teamLookup(db: SupabaseClient<Database>, me: MyEvent,
  filters: { search: string; hasRoom: boolean; track?: string }) {
  const [{ data, error }, trackResult] = await Promise.all([
    db.from('teams').select('id, name, track_id, totals:participants(count), listed:participants(id, first_name, last_name)')
      .eq('event_id', me.eventId)
      .eq('totals.event_id', me.eventId).is('totals.deleted_at', null)
      .eq('listed.event_id', me.eventId).eq('listed.directory_opt_in', true)
      .eq('listed.status', 'accepted').is('listed.deleted_at', null)
      .order('name').order('id').limit(500),
    me.event.tracksReleased
      ? db.from('tracks').select('id, name').eq('event_id', me.eventId).order('name')
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (error) throw new Error(`team lookup failed (${error.code})`);
  if (trackResult.error) throw new Error(`team tracks lookup failed (${trackResult.error.code})`);
  const tracks = trackResult.data ?? [];
  const search = toSearchText(filters.search);
  const teams = (data ?? []).filter((t) =>
    toSearchText(t.name).includes(search)
    && (!filters.hasRoom || (t.totals[0]?.count ?? 0) < 4)
    && (!me.event.tracksReleased || !filters.track || t.track_id === filters.track),
  ).map((t) => {
    const count = t.totals[0]?.count ?? 0;
    return {
      id: t.id, name: t.name, count, spots: Math.max(0, 4 - count), own: t.id === me.teamId,
      track: tracks.find((track) => track.id === t.track_id)?.name ?? null,
      members: t.listed.map((p) => ({ name: `${p.first_name} ${p.last_name}`.trim(), self: p.id === me.participantId })),
      hidden: count - t.listed.length,
    };
  });
  return { teams, tracks };
}
